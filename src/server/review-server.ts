import express from 'express';
import { WebSocketServer } from 'ws';
import open from 'open';
import { createServer, type Server as HttpServer } from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  ReviewServerConfig,
  HealingEvent,
  ReviewAction,
} from '../types/index';
import { createRoutes } from './routes';
import { logger } from '../utils/logger';

export class ReviewServer {
  private readonly config: ReviewServerConfig;
  private events: HealingEvent[];
  private app: express.Application;
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private reviewResolve: ((events: HealingEvent[]) => void) | null = null;

  constructor(config: ReviewServerConfig, events: HealingEvent[]) {
    this.config = config;
    this.events = events;
    this.app = express();

    this.setupApp();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise<void>((resolveStart, rejectStart) => {
      this.httpServer = createServer(this.app);

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws) => {
        logger.debug('WebSocket client connected');

        ws.send(
          JSON.stringify({
            type: 'init',
            events: this.events,
            summary: this.buildSummary(),
          }),
        );

        ws.on('close', () => {
          logger.debug('WebSocket client disconnected');
        });
      });

      this.httpServer.listen(this.config.port, () => {
        const url = `http://localhost:${this.config.port}`;
        logger.info(`Review server started at ${url}`);

        if (this.config.openBrowser) {
          open(url).catch((err) => {
            logger.warn('Failed to open browser', err);
          });
        }

        resolveStart();
      });

      this.httpServer.on('error', (err) => {
        logger.error('Review server failed to start', err);
        rejectStart(err);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise<void>((resolveStop) => {
      logger.info('Shutting down review server...');

      if (this.wss) {
        for (const client of this.wss.clients) {
          client.close(1000, 'Server shutting down');
        }
        this.wss.close();
        this.wss = null;
      }

      if (this.httpServer) {
        this.httpServer.close(() => {
          this.httpServer = null;
          logger.info('Review server stopped');
          resolveStop();
        });
      } else {
        resolveStop();
      }
    });
  }

  async waitForReview(): Promise<HealingEvent[]> {
    if (this.allReviewed()) {
      return this.events;
    }

    return new Promise<HealingEvent[]>((resolve) => {
      this.reviewResolve = resolve;
    });
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  private setupApp(): void {
    const router = createRoutes(this.events, (event) =>
      this.onEventUpdated(event),
    );
    this.app.use(router);

    // Serve the dashboard UI
    this.app.get('/', (_req, res) => {
      try {
        const htmlPath = resolve(dirname(__filename), 'ui', 'index.html');
        let html = readFileSync(htmlPath, 'utf-8');
        // Inject the port so the client-side JS can connect to WebSocket
        html = html.replace(
          '{{WS_PORT}}',
          String(this.config.port),
        );
        html = html.replace(
          '{{AUTO_CLOSE}}',
          String(this.config.autoCloseAfterReview),
        );
        res.type('html').send(html);
      } catch (err) {
        logger.error('Failed to serve dashboard UI', err);
        res.status(500).send('Failed to load dashboard');
      }
    });
  }

  private onEventUpdated(event: HealingEvent): void {
    logger.info(
      `Event ${event.id} review status changed to ${event.reviewStatus}`,
    );

    this.broadcastUpdate(event);

    if (this.allReviewed()) {
      logger.info('All events have been reviewed');

      this.broadcastAllReviewed();

      if (this.reviewResolve) {
        const resolve = this.reviewResolve;
        this.reviewResolve = null;

        if (this.config.autoCloseAfterReview) {
          // Give the client a moment to show the completion UI
          setTimeout(() => {
            this.stop().then(() => resolve(this.events));
          }, 3000);
        } else {
          resolve(this.events);
        }
      }
    }
  }

  private broadcastUpdate(event: HealingEvent): void {
    if (!this.wss) return;

    const message = JSON.stringify({
      type: 'update',
      event,
      summary: this.buildSummary(),
    });

    for (const client of this.wss.clients) {
      if (client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(message);
      }
    }
  }

  private broadcastAllReviewed(): void {
    if (!this.wss) return;

    const message = JSON.stringify({
      type: 'all-reviewed',
      summary: this.buildSummary(),
    });

    for (const client of this.wss.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  private allReviewed(): boolean {
    return this.events.every((e) => e.reviewStatus !== 'pending');
  }

  private buildSummary() {
    return {
      total: this.events.length,
      approved: this.events.filter((e) => e.reviewStatus === 'approved').length,
      rejected: this.events.filter((e) => e.reviewStatus === 'rejected').length,
      pending: this.events.filter((e) => e.reviewStatus === 'pending').length,
    };
  }
}

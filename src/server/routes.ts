import express from 'express';
import type { HealingEvent, ReviewSummary } from '../types/index';

export function createRoutes(
  events: HealingEvent[],
  onUpdate: (event: HealingEvent) => void,
): express.Router {
  const router = express.Router();

  router.use(express.json());

  // ─── GET /api/heals ──────────────────────────────────────────────────────────

  router.get('/api/heals', (_req, res) => {
    res.json(events);
  });

  // ─── GET /api/heals/:id ──────────────────────────────────────────────────────

  router.get('/api/heals/:id', (req, res) => {
    const event = events.find((e) => e.id === req.params.id);
    if (!event) {
      res.status(404).json({ error: 'Healing event not found' });
      return;
    }
    res.json(event);
  });

  // ─── POST /api/heals/:id/approve ─────────────────────────────────────────────

  router.post('/api/heals/:id/approve', (req, res) => {
    const event = events.find((e) => e.id === req.params.id);
    if (!event) {
      res.status(404).json({ error: 'Healing event not found' });
      return;
    }

    event.reviewStatus = 'approved';

    const { editedLocator } = req.body as { editedLocator?: string };
    if (editedLocator && event.healedLocator) {
      event.healedLocator = {
        ...event.healedLocator,
        selector: editedLocator,
        playwrightExpression: editedLocator,
      };
    }

    onUpdate(event);
    res.json(event);
  });

  // ─── POST /api/heals/:id/reject ──────────────────────────────────────────────

  router.post('/api/heals/:id/reject', (req, res) => {
    const event = events.find((e) => e.id === req.params.id);
    if (!event) {
      res.status(404).json({ error: 'Healing event not found' });
      return;
    }

    event.reviewStatus = 'rejected';
    onUpdate(event);
    res.json(event);
  });

  // ─── POST /api/approve-all ────────────────────────────────────────────────────

  router.post('/api/approve-all', (_req, res) => {
    const pending = events.filter((e) => e.reviewStatus === 'pending');
    for (const event of pending) {
      event.reviewStatus = 'approved';
      onUpdate(event);
    }
    res.json({ updated: pending.length });
  });

  // ─── POST /api/reject-all ────────────────────────────────────────────────────

  router.post('/api/reject-all', (_req, res) => {
    const pending = events.filter((e) => e.reviewStatus === 'pending');
    for (const event of pending) {
      event.reviewStatus = 'rejected';
      onUpdate(event);
    }
    res.json({ updated: pending.length });
  });

  // ─── POST /api/approve-high-confidence ────────────────────────────────────────

  router.post('/api/approve-high-confidence', (_req, res) => {
    const highConfidence = events.filter(
      (e) => e.reviewStatus === 'pending' && e.confidence > 0.9,
    );
    for (const event of highConfidence) {
      event.reviewStatus = 'approved';
      onUpdate(event);
    }
    res.json({ updated: highConfidence.length });
  });

  // ─── GET /api/summary ─────────────────────────────────────────────────────────

  router.get('/api/summary', (_req, res) => {
    const summary: ReviewSummary = {
      total: events.length,
      approved: events.filter((e) => e.reviewStatus === 'approved').length,
      rejected: events.filter((e) => e.reviewStatus === 'rejected').length,
      pending: events.filter((e) => e.reviewStatus === 'pending').length,
    };
    res.json(summary);
  });

  return router;
}

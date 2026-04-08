import type { Page, Locator } from '@playwright/test';
import type { HealingSession } from './index';

declare module '@playwright/test' {
  interface Page {
    _mindHealSession?: HealingSession;
    _mindHealOriginalLocator?: typeof Page.prototype.locator;
  }
}

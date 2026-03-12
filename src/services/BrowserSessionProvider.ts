import type { BrowserSessionService } from './BrowserSessionService';

let browserSessionService: BrowserSessionService | null = null;

export function setBrowserSessionService(service: BrowserSessionService) {
    browserSessionService = service;
}

export function getBrowserSessionService(): BrowserSessionService | null {
    return browserSessionService;
}

import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { getBrowserSessionService } from '../../services/BrowserSessionProvider';

function getServiceOrError() {
    const service = getBrowserSessionService();
    if (!service) {
        return { error: 'Error: Browser session service is not available.' };
    }
    return { service };
}

export class BrowserNavigateTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'browser_navigate',
            description: 'Open or reuse a local browser session and navigate to an http or https URL.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL to open in the browser session' },
                },
                required: ['url'],
            },
        };
    }

    async execute(args: { url: string }): Promise<string> {
        const { service, error } = getServiceOrError();
        if (!service) return error!;
        return service.navigate(args?.url);
    }
}

export class BrowserClickTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'browser_click',
            description: 'Click an element in the active browser session using a CSS selector.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector for the target element' },
                },
                required: ['selector'],
            },
        };
    }

    async execute(args: { selector: string }): Promise<string> {
        const { service, error } = getServiceOrError();
        if (!service) return error!;
        return service.click(args?.selector);
    }
}

export class BrowserTypeTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'browser_type',
            description: 'Type text into an input element in the active browser session.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector for the input element' },
                    text: { type: 'string', description: 'Text to enter into the element' },
                    submit: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
                },
                required: ['selector', 'text'],
            },
        };
    }

    async execute(args: { selector: string; text: string; submit?: boolean }): Promise<string> {
        const { service, error } = getServiceOrError();
        if (!service) return error!;
        return service.type(args);
    }
}

export class BrowserScrollTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'browser_scroll',
            description: 'Scroll the active browser page by direction or explicit x/y offsets.',
            parameters: {
                type: 'object',
                properties: {
                    direction: { type: 'string', description: 'Scroll direction: up or down' },
                    amount: { type: 'number', description: 'Scroll amount in pixels (default: 700)' },
                    x: { type: 'number', description: 'Horizontal scroll delta in pixels' },
                    y: { type: 'number', description: 'Vertical scroll delta in pixels' },
                },
            },
        };
    }

    async execute(args: { direction?: 'up' | 'down'; amount?: number; x?: number; y?: number }): Promise<string> {
        const { service, error } = getServiceOrError();
        if (!service) return error!;
        return service.scroll(args || {});
    }
}

export class BrowserWaitForTextTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'browser_wait_for_text',
            description: 'Wait until specific text appears in the active browser page.',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'Text to wait for in the page body' },
                    timeoutMs: { type: 'number', description: 'Maximum wait time in milliseconds (default: 10000)' },
                },
                required: ['text'],
            },
        };
    }

    async execute(args: { text: string; timeoutMs?: number }): Promise<string> {
        const { service, error } = getServiceOrError();
        if (!service) return error!;
        return service.waitForText(args?.text, args?.timeoutMs);
    }
}

export class BrowserScreenshotTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'browser_screenshot',
            description: 'Capture a screenshot of the active browser session and persist it as a local artifact.',
            parameters: {
                type: 'object',
                properties: {
                    fullPage: { type: 'boolean', description: 'Capture the full page instead of the viewport' },
                },
            },
        };
    }

    async execute(args: { fullPage?: boolean }): Promise<string> {
        const { service, error } = getServiceOrError();
        if (!service) return error!;
        return service.screenshot(Boolean(args?.fullPage));
    }
}

export class BrowserConsoleLogsTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'browser_console_logs',
            description: 'Persist the recent browser console messages into a local artifact and return a summary.',
            parameters: {
                type: 'object',
                properties: {},
            },
        };
    }

    async execute(): Promise<string> {
        const { service, error } = getServiceOrError();
        if (!service) return error!;
        return service.consoleLogs();
    }
}

export class BrowserCloseTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'browser_close',
            description: 'Close the active local browser session and release the page/browser process.',
            parameters: {
                type: 'object',
                properties: {},
            },
        };
    }

    async execute(): Promise<string> {
        const { service, error } = getServiceOrError();
        if (!service) return error!;
        return service.close();
    }
}

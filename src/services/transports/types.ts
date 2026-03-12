import type { Message, Tool } from '../../core/types';
import type { ProviderId } from '../providerCatalog';

export interface StreamCallbacks {
    onThinking?: (thinking: string) => void;
    onContent?: (content: string) => void;
}

export interface TransportRequest extends StreamCallbacks {
    providerId: ProviderId;
    baseUrl: string;
    headers: Record<string, string>;
    model: string;
    messages: Message[];
    tools: Tool[];
    abortSignal?: AbortSignal;
}

export interface ChatTransportAdapter {
    chat(request: TransportRequest): Promise<any>;
}

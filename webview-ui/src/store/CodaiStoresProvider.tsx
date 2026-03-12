import type { PropsWithChildren } from 'react';
import { ChatRuntimeStoreProvider } from './ChatRuntimeStore';
import { ExtensionStoreProvider } from './ExtensionStore';

export function CodaiStoresProvider({ children }: PropsWithChildren) {
  return (
    <ExtensionStoreProvider>
      <ChatRuntimeStoreProvider>{children}</ChatRuntimeStoreProvider>
    </ExtensionStoreProvider>
  );
}

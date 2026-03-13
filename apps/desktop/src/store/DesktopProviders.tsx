import type { PropsWithChildren } from 'react';
import { RuntimeStoreProvider } from './RuntimeStore';
import { WorkbenchStoreProvider } from './WorkbenchStore';

export function DesktopProviders({ children }: PropsWithChildren) {
  return (
    <WorkbenchStoreProvider>
      <RuntimeStoreProvider>{children}</RuntimeStoreProvider>
    </WorkbenchStoreProvider>
  );
}

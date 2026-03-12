export const badHtmlFixture = `
  <html>
    <head><title>Broken <b>Docs</title></head>
    <body>
      <main>
        <h1>Almost valid page
        <p>HTML parser recovery should still surface readable text.
        <a href="/docs/api">API docs
      </main>
    </body>
  </html>
`;

export const emptyHtmlFixture = `
  <html>
    <head>
      <title>Shell Page</title>
      <meta name="robots" content="noindex,nofollow">
      <link rel="canonical" href="https://example.com/canonical-shell" />
    </head>
    <body>
      <script>console.log('empty shell');</script>
      <style>body { display:none; }</style>
    </body>
  </html>
`;

export const redirectChainFixture = [
    {
        status: 302,
        headers: {
            location: 'https://example.com/docs/intermediate',
        },
    },
    {
        status: 301,
        headers: {
            location: '/docs/final',
        },
    },
    {
        status: 200,
        headers: {
            'content-type': 'text/html; charset=utf-8',
        },
        body: `
          <html>
            <head><title>Redirect Target</title></head>
            <body>
              <h1>Resolved page</h1>
              <p>Redirect chains should preserve source metadata.</p>
            </body>
          </html>
        `,
    },
];

export const binaryResponseFixture = {
    status: 200,
    headers: {
        'content-type': 'image/png',
    },
    body: 'PNG',
};

export function createAbortError(message = 'aborted'): Error & { name: string } {
    const error = new Error(message) as Error & { name: string };
    error.name = 'AbortError';
    return error;
}

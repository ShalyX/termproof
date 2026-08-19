import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';

const title = 'Termproof — Terms, tested.';
const description = 'Proof before release. Termproof tests technical milestone terms against reproducible GitHub, HTTP, Base/EVM, and npm evidence.';

export const metadata: Metadata = {
  metadataBase: new URL('https://grant-milestone-verifier.nova-sparkle5f.chatgpt.site'),
  title,
  description,
  applicationName: 'Termproof',
  alternates: { canonical: '/' },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg',
    apple: '/brand/termproof-app-icon.svg',
  },
  manifest: '/site.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    siteName: 'Termproof',
    title,
    description,
  },
  twitter: {
    card: 'summary',
    title,
    description,
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#171715',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

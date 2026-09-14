import type { Metadata, Viewport } from "next";
import { Carlito, Open_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Kognoz specifies Calibri for headings. Calibri is a licensed Microsoft face;
 * Carlito is its metric-compatible open clone and is what we ship until a
 * licensed Calibri is supplied (drop it into ./fonts and it takes priority via
 * the CSS stack in globals.css).
 */
const head = Carlito({
  variable: "--font-k-head",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

const body = Open_Sans({
  variable: "--font-k-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-k-mono",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kora",
  description: "Kognoz client delivery tracker",
  applicationName: "Kora",
  appleWebApp: { capable: true, title: "Kora", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#005184",
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies the persisted theme before first paint so dark users never see a
 * white flash. Reads the legacy `itk_dark` key so preferences carry over from
 * the old app at cutover. Kept tiny and dependency-free on purpose.
 */
const NO_FLASH = `
try {
  var d = localStorage.getItem('itk_dark');
  if (d === '1' || (d === null && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${head.variable} ${body.variable} ${mono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

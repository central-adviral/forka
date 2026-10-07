import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// The prototype sets every word in Geist and every number in Geist Mono. The old Manrope and Sora
// variables are aliased to Geist in globals.css, so no component has to change its class.
const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Central de Tráfego",
  description: "Black Sheep · performance de tráfego por cliente e projeto",
};

// Applied before the first paint so a light-mode user never sees a dark flash.
const THEME_BOOT = `try{if(localStorage.getItem('ct-mode')==='light')document.documentElement.dataset.mode='light'}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

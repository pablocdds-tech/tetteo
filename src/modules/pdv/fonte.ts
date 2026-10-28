import localFont from "next/font/local";

/** Mesma família da referência, hospedada localmente sob a licença OFL. */
export const fontePdv = localFont({
  src: [
    { path: "./assets/fonts/muli-300.ttf", weight: "300", style: "normal" },
    { path: "./assets/fonts/muli-400.ttf", weight: "400", style: "normal" },
    { path: "./assets/fonts/muli-600.ttf", weight: "600", style: "normal" },
    { path: "./assets/fonts/muli-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--fonte-pdv",
  display: "swap",
  fallback: ["Arial", "Helvetica", "sans-serif"],
});

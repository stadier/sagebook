import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            registerType: "autoUpdate",
            injectRegister: "auto",
            includeAssets: ["icon.svg"],
            manifest: {
                name: "Sagebook",
                short_name: "Sagebook",
                description: "Capture-first wealth ledger",
                theme_color: "#020617",
                background_color: "#020617",
                display: "standalone",
                start_url: "/inbox",
                icons: [
                    {
                        src: "/icon.svg",
                        sizes: "any",
                        type: "image/svg+xml",
                        purpose: "any",
                    },
                ],
                // OS share sheet → /capture with text/url prefilled (GET only;
                // file shares need a custom SW POST handler — see TODO.md).
                share_target: {
                    action: "/capture",
                    method: "GET",
                    params: {
                        title: "title",
                        text: "text",
                        url: "url",
                    },
                },
            },
        }),
    ],
});

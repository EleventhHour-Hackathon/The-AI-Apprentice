import App from "./App.jsx";
import { NextUIProvider } from "@nextui-org/react";
import { ThemeProvider } from "./ThemeProvider.tsx";
import { ReactFlowProvider } from "@xyflow/react";

export const Providers = () => {
  return (
    <ReactFlowProvider>
      <NextUIProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <App />
        </ThemeProvider>
      </NextUIProvider>
    </ReactFlowProvider>
  );
};

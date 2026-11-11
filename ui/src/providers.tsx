import { useEffect, useState, type ReactNode } from "react";
import { MotionConfig, MotionGlobalConfig } from "motion/react";
import { ShapeProvider } from "@/lib/shape-context";
import { SizeProvider } from "@/lib/size-context";
import { IconProvider } from "@/lib/icon-context";
import { tablerIcons } from "@/lib/icons-tabler";

// The renderer's motion setting: body[data-motion] is "full", "reduced" or "off" (motion.js).
type MotionMode = "full" | "reduced" | "off";
const readMode = (): MotionMode => {
  const mode = document.body.dataset.motion;
  return mode === "reduced" || mode === "off" ? mode : "full";
};

function useMotionMode(): MotionMode {
  const [mode, setMode] = useState(readMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-motion"] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

// One wrapper for every island: the app's motion setting, rounded corners, the default size step
// and Tabler icons (the set the legacy renderer already draws from assets/ui).
export function UiProviders({ children }: { children: ReactNode }) {
  const mode = useMotionMode();
  // "off" ends every Motion animation at its target at once; "reduced" keeps fades and drops movement.
  MotionGlobalConfig.skipAnimations = mode === "off";
  return (
    <MotionConfig reducedMotion={mode === "full" ? "never" : "always"}>
      <ShapeProvider defaultShape="rounded">
        <SizeProvider defaultSize="default">
          <IconProvider icons={tablerIcons}>{children}</IconProvider>
        </SizeProvider>
      </ShapeProvider>
    </MotionConfig>
  );
}

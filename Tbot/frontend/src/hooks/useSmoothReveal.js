import { useEffect, useRef, useState } from "react";

const WORD_INTERVAL_MS = 38;

/** Reveals targetText word-by-word for a smooth typewriter effect. */
export function useSmoothReveal(targetText, active) {
  const [displayed, setDisplayed] = useState("");
  const displayedRef = useRef("");
  const targetRef = useRef(targetText);

  targetRef.current = targetText;

  useEffect(() => {
    if (targetText.length < displayedRef.current.length) {
      displayedRef.current = "";
      setDisplayed("");
    }
  }, [targetText]);

  useEffect(() => {
    const shouldAnimate =
      active || displayedRef.current.length < targetRef.current.length;

    if (!shouldAnimate) {
      displayedRef.current = targetText;
      setDisplayed(targetText);
      return;
    }

    const tick = () => {
      const target = targetRef.current;
      let current = displayedRef.current;

      if (current.length >= target.length) return;

      const backlog = target.length - current.length;
      const wordsPerTick = backlog > 120 ? 4 : backlog > 60 ? 3 : backlog > 25 ? 2 : 1;

      for (let n = 0; n < wordsPerTick && current.length < target.length; n++) {
        const remainder = target.slice(current.length);
        const match = remainder.match(/^(\s+|\S+\s?)/);
        const piece = match ? match[0] : remainder.charAt(0);
        current += piece;
      }

      displayedRef.current = current;
      setDisplayed(current);
    };

    const id = setInterval(tick, WORD_INTERVAL_MS);
    return () => clearInterval(id);
  }, [targetText, active]);

  return displayed;
}

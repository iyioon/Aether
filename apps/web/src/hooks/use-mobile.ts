import * as React from "react";

const MOBILE_QUERY =
  "(max-width: 767px), (max-width: 1024px) and (hover: none) and (pointer: coarse)";

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(
    () =>
      typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => {
      setIsMobile(mql.matches);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

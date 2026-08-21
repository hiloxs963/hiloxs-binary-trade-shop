import { useEffect, useState } from "react";

/** Key the admin types to unlock control panels. */
export const ADMIN_KEY = "HILOXS-ADMIN";

const FLAG = "hiloxs-admin-mode";
const EVENT = "hiloxs-admin-mode-change";

/** Turn admin surfaces on/off from anywhere (e.g. the footer key box). */
export function setAdminMode(on: boolean): void {
  if (on) localStorage.setItem(FLAG, "1");
  else localStorage.removeItem(FLAG);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Admin surfaces (uploads, trade outcome control, till float) are invisible to
 * normal shoppers. They appear after entering the admin key in the footer
 * "Admin access" box (or visiting with `?admin=1`).
 */
export function useAdminMode(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const read = () => setVisible(localStorage.getItem(FLAG) === "1");
    const param = new URLSearchParams(window.location.search).get("admin");
    if (param === "1") setAdminMode(true);
    else if (param === "0") setAdminMode(false);
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  return visible;
}

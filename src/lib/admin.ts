import { useEffect, useState } from "react";

/** Key the admin types to unlock control panels. */
export const ADMIN_KEY = "HILOXS-ADMIN";

const FLAG = "hiloxs-admin-mode";

/**
 * Admin surfaces (uploads, trade outcome control, till float) are invisible to
 * normal shoppers. They only appear after visiting the site with `?admin=1`,
 * and the admin still has to enter the admin key to act.
 */
export function useAdminMode(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("admin");
    if (param === "1") {
      localStorage.setItem(FLAG, "1");
      setVisible(true);
      return;
    }
    if (param === "0") {
      localStorage.removeItem(FLAG);
      setVisible(false);
      return;
    }
    setVisible(localStorage.getItem(FLAG) === "1");
  }, []);

  return visible;
}

/**
 * Unit tests สำหรับ safeNavigate — ตัวนำทางสำรองเมื่อ App Router dispatch โยน
 * "Router action dispatched before initialization" (คลิกก่อน hydration จบ / HMR ค้าง)
 *
 * ทดสอบใน node environment โดย stub global window เอง — ไม่ต้องพึ่ง jest-environment-jsdom
 */
import { safeNavigate } from "@/lib/safe-navigate";

describe("safeNavigate", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  const stubWindow = () => {
    const w = {
      location: {
        assign: jest.fn(),
        replace: jest.fn(),
      },
    };
    (globalThis as { window?: unknown }).window = w;
    return w;
  };

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("router ปกติ: เรียก push และไม่ตกไปใช้ window.location", () => {
    const win = stubWindow();
    const push = jest.fn();

    safeNavigate({ push }, "/production/history/PRD-1");

    expect(push).toHaveBeenCalledWith("/production/history/PRD-1");
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it("router.push โยน (dispatch before initialization): fallback เป็น window.location.assign", () => {
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const win = stubWindow();

    safeNavigate(
      {
        push: () => {
          throw new Error("Internal Next.js error: Router action dispatched before initialization.");
        },
      },
      "/production/history"
    );

    expect(win.location.assign).toHaveBeenCalledWith("/production/history");
    consoleWarn.mockRestore();
  });

  it("method replace: เรียก router.replace ปกติ หรือ window.location.replace เมื่อพัง", () => {
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const win = stubWindow();
    const replaceFn = jest.fn();

    // กรณีปกติ
    safeNavigate({ replace: replaceFn }, "/dashboard", "replace");
    expect(replaceFn).toHaveBeenCalledWith("/dashboard");
    expect(win.location.replace).not.toHaveBeenCalled();

    // กรณี router พัง
    safeNavigate(
      {
        replace: () => {
          throw new Error("boom");
        },
      },
      "/employee-login",
      "replace"
    );
    expect(win.location.replace).toHaveBeenCalledWith("/employee-login");
    consoleWarn.mockRestore();
  });

  it("router ไม่มีเมธอดเลย ไม่โยน — ไม่ทำอะไร", () => {
    stubWindow();
    expect(() => safeNavigate({}, "/x")).not.toThrow();
  });
});

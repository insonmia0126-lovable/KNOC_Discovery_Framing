export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { db, drainQueue } = await import("./server/service");
  const timer = setInterval(() => {
    drainQueue(db(), 2).catch(() => undefined);
  }, 1500);
  timer.unref?.();
}

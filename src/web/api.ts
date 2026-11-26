import { useEffect, useState } from "react";
import type { ApiError } from "../shared/types";

export const SESSION_ENDED = "account-checker:session-ended";

export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function request<T>(path: string, options: { body?: object; signal?: AbortSignal } = {}): Promise<T> {
  const { body, signal } = options;
  const response = await fetch("/api" + path, {
    cache: "no-store",
    signal,
    ...(body && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) {
    const data: ApiError | undefined = await response.json().catch(() => undefined);
    const sessionEnded = response.status === 401 || data?.error?.code === "banned";
    if (!signal?.aborted && sessionEnded && (!path.startsWith("/auth/") || path === "/auth/password")) {
      window.dispatchEvent(new Event(SESSION_ENDED));
    }
    throw new RequestError(response.status, data?.error?.message ?? "请求失败，请重试。");
  }
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown) {
  return error instanceof RequestError ? error.message : "连接失败，请重试。";
}

interface Resource<T> {
  data?: T;
  error?: string;
}

export function useResource<T>(path: string, poll?: boolean | ((data: T) => boolean)) {
  const [key, setKey] = useState(0);
  const [result, setResult] = useState<Resource<T> & { path: string; key: number }>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let data: T | undefined;

    async function load() {
      try {
        data = await request<T>(path, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ path, key, data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ path, key, data, error: errorMessage(error) });
      }
      const needsPoll = typeof poll === "function" ? data !== undefined && poll(data) : poll;
      if (!controller.signal.aborted && needsPoll) timer = setTimeout(load, 4000);
    }

    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, key, poll]);

  const current = result?.path === path && result.key === key ? result : undefined;
  return { ...current, reload: () => setKey((value) => value + 1) };
}

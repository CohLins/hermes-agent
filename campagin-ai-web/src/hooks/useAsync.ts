import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
}

interface Result<T> {
  /** 该结果对应的请求标识，与当前标识不一致即表示仍在加载。 */
  requestKey: string;
  data?: T;
  error?: string;
}

/**
 * 列表页统一的加载 / 错误 / 重试三态。
 *
 * - `deps` 变化或调用 `reload()` 都会重新拉取；deps 需为可序列化的基础值。
 * - loading 由「当前请求标识 ≠ 已完成结果的标识」推导，而不是在 effect 里同步 setState。
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState<Result<T>>({ requestKey: "" });
  const requestKey = `${reloadCount}|${JSON.stringify(deps)}`;

  // loader 多为内联箭头函数，每次渲染标识都会变，所以放进 ref 而不是依赖数组。
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let cancelled = false;
    loaderRef
      .current()
      .then((value) => {
        if (!cancelled) setResult({ requestKey, data: value });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({
            requestKey,
            error: err instanceof Error ? err.message : "加载失败，请重试",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const reload = useCallback(() => setReloadCount((x) => x + 1), []);
  const settled = result.requestKey === requestKey;

  return {
    data: settled ? result.data : undefined,
    loading: !settled,
    error: settled ? result.error : undefined,
    reload,
  };
}

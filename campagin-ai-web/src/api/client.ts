/**
 * 阶段一的 API 层：函数签名与返回类型即为阶段二的契约，
 * 目前实现是延迟一小段时间后返回 src/mock 里的数据，并只在内存里保存写入结果。
 * 页面只依赖 src/api，不直接 import src/mock —— 阶段二把函数体换成 fetch 即可。
 */

const MIN_DELAY = 180;
const MAX_DELAY = 420;

export function delay(ms?: number): Promise<void> {
  const wait = ms ?? MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
  return new Promise((resolve) => setTimeout(resolve, wait));
}

/** 返回 mock 数据的深拷贝，避免页面改动污染 mock 常量。 */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

export async function mockGet<T>(value: T, ms?: number): Promise<T> {
  await delay(ms);
  return clone(value);
}

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

import type { CrmUser } from "./scope";

// Small in-process dispatcher preserves the CRM's validated route contracts.
// Authentication, CSRF and session scope are enforced by the Next route handler.
export type Request = {
  user: CrmUser;
  query: Record<string, string>;
  params: Record<string, string>;
  body: unknown;
  method: string;
  path: string;
  header(name: string): string | undefined;
};
export class Response {
  code = 200;
  payload: unknown;
  headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  status(code: number) {
    this.code = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers.set(name, value);
    return this;
  }
  json(value: unknown) {
    this.payload = value;
    return this;
  }
  toWeb() {
    return globalThis.Response.json(this.payload ?? {}, {
      status: this.code,
      headers: this.headers,
    });
  }
}
type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
export function Router() {
  const routes: { method: string; segments: string[]; handler: Handler }[] = [];
  function register(method: string, path: string, handler: Handler) {
    routes.push({ method, segments: path.split("/").filter(Boolean), handler });
  }
  return {
    get: (path: string, handler: Handler) => register("GET", path, handler),
    post: (path: string, handler: Handler) => register("POST", path, handler),
    put: (path: string, handler: Handler) => register("PUT", path, handler),
    async dispatch(req: Request): Promise<globalThis.Response | null> {
      const parts = req.path.split("/").filter(Boolean);
      const route = routes.find(
        (r) =>
          r.method === req.method &&
          r.segments.length === parts.length &&
          r.segments.every((s, i) => s.startsWith(":") || s === parts[i]),
      );
      if (!route) return null;
      const params = Object.fromEntries(
        route.segments.flatMap((s, i) =>
          s.startsWith(":") ? [[s.slice(1), parts[i]]] : [],
        ),
      );
      const res = new Response();
      await route.handler({ ...req, params }, res);
      return res.toWeb();
    },
  };
}

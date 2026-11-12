/** Minimal XMLHttpRequest stand-in: tests drive progress and the response by hand. */
export class FakeXHR {
  static instances: FakeXHR[] = [];

  upload: {
    onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
    onload: (() => void) | null;
  } = {
    onprogress: null,
    onload: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  statusText = "";
  responseText = "";
  responseType = "";
  withCredentials = false;
  method = "";
  url = "";
  body: FormData | null = null;
  aborted = false;

  static reset() {
    FakeXHR.instances = [];
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body: FormData) {
    this.body = body;
    FakeXHR.instances.push(this);
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  progress(fraction: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: fraction * 100, total: 100 });
  }

  /** All bytes sent; the server is still working. */
  uploaded() {
    this.upload.onload?.();
  }

  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }

  fail() {
    this.onerror?.();
  }
}

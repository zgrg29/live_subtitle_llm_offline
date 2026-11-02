// 极简 WebSocket 服务端（RFC 6455 的子集）：握手、文本帧、分片、ping/pong、close。
// 只服务本机的两个端点，不追求完整实现；不引入外部依赖。
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 1024 * 1024;

class Connection {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.closed = false;
    this.finished = false;
    socket.setNoDelay(true);
    socket.on("data", (chunk) => this.push(chunk));
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.parse();
  }

  parse() {
    while (!this.closed) {
      if (this.buffer.length < 2) return;
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (length > MAX_FRAME_BYTES) { this.close(1009, "too large"); return; }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buffer = this.buffer.subarray(offset + length);
      this.handleFrame(fin, opcode, payload);
    }
  }

  handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) { this.close(); return; }
    if (opcode === 0x9) { this.writeFrame(0xa, payload); return; }
    if (opcode === 0xa) return;
    if (opcode === 0x0) {
      this.fragments.push(payload);
      if (fin) {
        const full = Buffer.concat(this.fragments);
        this.fragments = [];
        this.deliver(this.fragmentOpcode, full);
      }
      return;
    }
    if (fin) this.deliver(opcode, payload);
    else { this.fragmentOpcode = opcode; this.fragments = [payload]; }
  }

  deliver(opcode, payload) {
    if (opcode !== 0x1) return;
    try {
      if (this.onMessage) this.onMessage(payload.toString("utf8"));
    } catch {
      // 单条消息出错不能打断连接。
    }
  }

  writeFrame(opcode, payload) {
    if (this.socket.destroyed || this.socket.writableEnded) return;
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(text) {
    if (this.closed) return;
    this.writeFrame(0x1, Buffer.from(String(text), "utf8"));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.writeFrame(0x8, payload);
    this.closed = true;
    try { this.socket.end(); } catch {}
    this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.closed = true;
    try { if (this.onClose) this.onClose(); } catch {}
  }

  destroy() {
    this.closed = true;
    try { this.socket.destroy(); } catch {}
    this.finish();
  }
}

export function acceptWebSocket(req, socket, head, handlers = {}) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return null; }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  const connection = new Connection(socket, handlers.onMessage, handlers.onClose);
  if (head && head.length) connection.push(head);
  return connection;
}

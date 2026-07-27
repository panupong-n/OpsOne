// src/lib/pkce.ts
// PKCE (Proof Key for Code Exchange) — RFC 7636
// Pure JS SHA-256 implementation — works in non-secure (HTTP) contexts
// unlike crypto.subtle which requires HTTPS/localhost

// ─── Pure-JS SHA-256 ──────────────────────────────────────────────────────────
// Based on the reference implementation, works everywhere without Web Crypto API

function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
}

function sha256Pure(input: string): Uint8Array {
    const K: number[] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const bytes = new TextEncoder().encode(input);
    const bitLen = bytes.length * 8;

    // Padding
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    new DataView(padded.buffer).setUint32(padded.length - 4, bitLen, false);

    for (let i = 0; i < padded.length; i += 64) {
        const w: number[] = [];
        for (let j = 0; j < 16; j++) {
            w[j] = new DataView(padded.buffer, i + j * 4, 4).getUint32(0, false);
        }
        for (let j = 16; j < 64; j++) {
            const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
            const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
        for (let j = 0; j < 64; j++) {
            const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
            const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;
            [h, g, f, e, d, c, b, a] = [g, f, e, (d + temp1) >>> 0, c, b, a, (temp1 + temp2) >>> 0];
        }

        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    const result = new Uint8Array(32);
    const dv = new DataView(result.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => dv.setUint32(i * 4, v, false));
    return result;
}

// ─── Public PKCE helpers ──────────────────────────────────────────────────────

/**
 * สร้าง code_verifier แบบ random (43-128 ตัวอักษร base64url)
 * ใช้ crypto.getRandomValues() ซึ่งทำงานได้ใน HTTP ปกติ
 */
export function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array); // getRandomValues ใช้ได้ใน HTTP ไม่ต้อง HTTPS
    return btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * สร้าง code_challenge จาก verifier ด้วย SHA-256 → base64url
 * ใช้ pure-JS SHA-256 ที่ทำงานได้ทั้งใน HTTP และ HTTPS
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
    // ลอง crypto.subtle ก่อน (เร็วกว่า, มีใน HTTPS/localhost)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const data = new TextEncoder().encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    // Fallback: pure-JS SHA-256 สำหรับ non-secure contexts (HTTP)
    const digest = sha256Pure(verifier);
    return btoa(String.fromCharCode(...digest))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

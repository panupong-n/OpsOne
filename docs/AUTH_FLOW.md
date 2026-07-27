# TENCYBER SSO Integration Guide for System B

## Overview

TENCYBER ทำหน้าที่เป็น **Identity Provider (IdP)** ใช้มาตรฐาน **OAuth 2.0 + OpenID Connect (OIDC)**  
System B ทำหน้าที่เป็น **Relying Party (RP)** ที่ต้องการให้ผู้ใช้ login ผ่าน TENCYBER

**ข้อดีของระบบนี้:**
- ผู้ใช้ใช้ account เดียวกันทั้ง TENCYBER และ System B
- ถ้าผู้ใช้ login TENCYBER อยู่แล้ว สามารถเข้า System B ได้เลย (True SSO)
- **2FA จัดการที่ TENCYBER เพียงที่เดียว** — System B ได้รับ user ที่ผ่าน 2FA แล้วโดยอัตโนมัติ

---

## ข้อมูลสำคัญ (TENCYBER URLs)

| รายการ | URL |
|--------|-----|
| Base URL | `https://dashboard.tenfw.com` |
| OIDC Discovery | `https://dashboard.tenfw.com/api/oauth/.well-known/openid-configuration` |
| Authorization Endpoint | `https://dashboard.tenfw.com/api/oauth/authorize` |
| Token Endpoint | `https://dashboard.tenfw.com/api/oauth/token` |
| UserInfo Endpoint | `https://dashboard.tenfw.com/api/oauth/userinfo` |

---

## ขั้นตอนที่ 1 — ลงทะเบียน System B (ทำครั้งเดียวโดย TENCYBER Admin)

TENCYBER Admin ต้องทำ API call นี้ด้วย SUPER_ADMIN token:

```bash
curl -X POST https://dashboard.tenfw.com/api/oauth/clients \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "System B",
    "redirect_uris": [
      "https://SYSTEM_B_DOMAIN/api/auth/callback/tencyber"
    ],
    "scopes": ["openid", "email", "profile"]
  }'
```

ผลลัพธ์ที่ได้:
```json
{
  "client_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "client_secret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "name": "System B",
  "redirect_uris": ["https://SYSTEM_B_DOMAIN/api/auth/callback/tencyber"],
  "scopes": ["openid", "email", "profile"]
}
```

> **เก็บ `client_id` และ `client_secret` ไว้อย่างปลอดภัย** — จะใช้ในขั้นตอนต่อไป

---

## ขั้นตอนที่ 2 — ข้อมูล User ที่ System B จะได้รับ

หลัง login สำเร็จ System B จะได้รับข้อมูลผ่าน `/api/oauth/userinfo`:

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "given_name": "ชื่อ",
  "family_name": "นามสกุล",
  "name": "ชื่อ นามสกุล",
  "role": "SUPER_ADMIN | TENANT_ADMIN | ANALYST | VIEWER",
  "tenant_id": "tenant-uuid-or-null"
}
```

---

## ขั้นตอนที่ 3 — ติดตั้ง NextAuth.js บน System B (ถ้าใช้ Next.js)

### ติดตั้ง package
```bash
npm install next-auth
```

### สร้างไฟล์ `app/api/auth/[...nextauth]/route.ts`

```typescript
import NextAuth from "next-auth";
import type { NextAuthOptions } from "next-auth";

const TENCYBER_URL = "https://dashboard.tenfw.com";

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "tencyber",
      name: "TENCYBER SSO",
      type: "oauth",
      clientId: process.env.TENCYBER_CLIENT_ID!,
      clientSecret: process.env.TENCYBER_CLIENT_SECRET!,

      authorization: {
        url: `${TENCYBER_URL}/api/oauth/authorize`,
        params: { scope: "openid email profile" },
      },
      token: `${TENCYBER_URL}/api/oauth/token`,
      userinfo: `${TENCYBER_URL}/api/oauth/userinfo`,

      // Map TENCYBER user claims → NextAuth user object
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: null,
          role: profile.role,
          tenantId: profile.tenant_id,
        };
      },
    },
  ],

  callbacks: {
    // เก็บ role และ tenantId ลงใน JWT token ของ System B
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.tenantId = (user as any).tenantId;
        token.sub = (user as any).id;
      }
      return token;
    },
    // เปิดให้ session เข้าถึง role และ tenantId ได้
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        (session.user as any).role = token.role;
        (session.user as any).tenantId = token.tenantId;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",  // หน้า login ของ System B เอง (ถ้ามี)
  },

  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,   // session หมดหลัง 8 ชั่วโมง (เหมือน TENCYBER)
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

### ไฟล์ `.env` ของ System B

```env
# TENCYBER SSO credentials (ได้จากขั้นตอนที่ 1)
TENCYBER_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
TENCYBER_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# NextAuth settings
NEXTAUTH_SECRET=<random 32+ chars สุ่มใหม่>
NEXTAUTH_URL=https://SYSTEM_B_DOMAIN
```

### ประกาศ TypeScript types (ถ้าใช้ TypeScript)

สร้างไฟล์ `types/next-auth.d.ts`:
```typescript
import { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: string;
      tenantId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role: string;
    tenantId: string | null;
  }
}
```

---

## ขั้นตอนที่ 4 — ปุ่ม Login บน System B

### วิธีที่ 1: ปุ่ม Login ด้วย TENCYBER

```tsx
"use client";
import { signIn } from "next-auth/react";

export default function LoginButton() {
  return (
    <button
      onClick={() => signIn("tencyber", { callbackUrl: "/dashboard" })}
      className="btn btn-primary"
    >
      🔐 Login with TENCYBER
    </button>
  );
}
```

### วิธีที่ 2: Redirect อัตโนมัติถ้าไม่ได้ login

ในหน้าที่ต้องการ authentication:
```tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";

export default async function ProtectedPage() {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/protected-page");
  }

  return (
    <div>
      <p>สวัสดี {session.user.name}!</p>
      <p>Role: {(session.user as any).role}</p>
    </div>
  );
}
```

### วิธีที่ 3: Middleware (ป้องกันทุกหน้าด้วย session)

สร้างไฟล์ `middleware.ts` ที่ root ของ System B:
```typescript
export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/protected/:path*",
    // เพิ่มหน้าที่ต้องการ auth ที่นี่
  ],
};
```

---

## ขั้นตอนที่ 5 — ทดสอบ Flow ทั้งหมด

### Flow ปกติ (ไม่เคย login มาก่อน)
1. ผู้ใช้กดปุ่ม "Login with TENCYBER" บน System B
2. Redirect ไปหน้า login ของ TENCYBER: `https://dashboard.tenfw.com/login?redirect=...`
3. ผู้ใช้กรอก Email + Password บน TENCYBER
4. **ถ้าผู้ใช้เปิด 2FA** → TENCYBER แสดงหน้ากรอก OTP อัตโนมัติ
5. ผู้ใช้กรอก OTP จาก Authenticator App (Google Authenticator, Authy, etc.)
6. TENCYBER ยืนยันสำเร็จ → redirect กลับ System B พร้อม authorization code
7. System B แลก code → ได้ access token + user info
8. ผู้ใช้เข้าใช้งาน System B ได้

### Flow SSO (login TENCYBER อยู่แล้ว)
1. ผู้ใช้กดปุ่ม "Login with TENCYBER" บน System B
2. Redirect ไป TENCYBER — TENCYBER ตรวจพบ session cookie อยู่แล้ว
3. Redirect กลับ System B **ทันทีโดยไม่ต้องกรอก password ซ้ำ**
4. ผู้ใช้เข้าใช้งาน System B ได้

---

## เรื่อง 2FA — สำคัญมาก

| สถานการณ์ | พฤติกรรม |
|-----------|----------|
| ผู้ใช้เปิด 2FA บน TENCYBER | ต้องกรอก OTP ทุกครั้งที่ login ใหม่บน TENCYBER |
| ผู้ใช้ login TENCYBER อยู่แล้ว | ผ่าน 2FA แล้ว — System B ไม่ต้องถาม 2FA ซ้ำ |
| System B ต้องการ 2FA | **ไม่จำเป็น** เพราะ TENCYBER รับประกันตัวตนแล้ว |
| ผู้ใช้ต้องการเปิด/ปิด 2FA | ทำที่ Settings ของ TENCYBER เพียงที่เดียว |

**2FA ทำงานที่ฝั่ง TENCYBER เท่านั้น** — System B ไม่ต้องสร้าง 2FA เอง

---

## ทางเลือก: ถ้า System B ไม่ใช้ Next.js

### Python (FastAPI + HTTPX)
```python
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
import httpx, secrets, urllib.parse

TENCYBER_URL = "https://dashboard.tenfw.com"
CLIENT_ID = "your-client-id"
CLIENT_SECRET = "your-client-secret"
REDIRECT_URI = "https://system-b-domain/callback"

app = FastAPI()

@app.get("/login")
def login():
    state = secrets.token_urlsafe(16)
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "openid email profile",
        "state": state,
    }
    url = f"{TENCYBER_URL}/api/oauth/authorize?{urllib.parse.urlencode(params)}"
    return RedirectResponse(url)

@app.get("/callback")
async def callback(code: str, state: str):
    async with httpx.AsyncClient() as client:
        # Exchange code for token
        token_res = await client.post(
            f"{TENCYBER_URL}/api/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
            }
        )
        tokens = token_res.json()
        
        # Get user info
        userinfo_res = await client.get(
            f"{TENCYBER_URL}/api/oauth/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )
        user = userinfo_res.json()
        
    # user มี: sub, email, name, given_name, family_name, role, tenant_id
    return {"user": user}
```

### PHP (Laravel)
```php
// ใน config/services.php
'tencyber' => [
    'client_id'     => env('TENCYBER_CLIENT_ID'),
    'client_secret' => env('TENCYBER_CLIENT_SECRET'),
    'redirect'      => env('TENCYBER_REDIRECT_URI'),
],

// ติดตั้ง: composer require socialiteproviders/manager
// สร้าง Custom Socialite Provider หรือใช้ Generic OAuth2 library
```

---

## การตรวจสอบสิทธิ์ (Authorization) บน System B

System B สามารถใช้ `role` ที่ได้รับมาจาก TENCYBER ในการตรวจสอบสิทธิ์:

```typescript
// ตรวจสอบ role
const session = await getServerSession(authOptions);
const role = (session?.user as any)?.role;

if (role === "SUPER_ADMIN") {
  // เข้าถึงทุกฟีเจอร์
} else if (role === "TENANT_ADMIN") {
  // จัดการ tenant ของตัวเอง
} else if (role === "ANALYST") {
  // ดูข้อมูล + วิเคราะห์
} else if (role === "VIEWER") {
  // ดูอย่างเดียว
}
```

---

## Roles ที่มีใน TENCYBER

| Role | สิทธิ์ |
|------|--------|
| `SUPER_ADMIN` | ควบคุมทุกอย่าง — จัดการ tenant, user, OAuth clients |
| `TENANT_ADMIN` | จัดการ tenant และ user ของตัวเอง |
| `ANALYST` | ดูและวิเคราะห์ข้อมูล security |
| `VIEWER` | ดูข้อมูลอย่างเดียว (read-only) |

---

## ⚡ PKCE Flow สำหรับ Vite SPA (Public Client — ไม่มี client_secret)

> **ใช้เมื่อ System B เป็น SPA (Vite, React, Vue ฯลฯ)**  
> SPA ทำงานใน browser ทั้งหมด ไม่สามารถเก็บ `client_secret` ได้อย่างปลอดภัย  
> PKCE (Proof Key for Code Exchange, RFC 7636) คือมาตรฐาน OAuth 2.1 สำหรับกรณีนี้

### ขั้นตอนที่ 1 — ลงทะเบียน Public Client

```bash
curl -X POST https://dashboard.tenfw.com/api/oauth/clients \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "System B SPA",
    "is_public": true,
    "redirect_uris": [
      "https://SYSTEM_B_DOMAIN/callback"
    ],
    "scopes": ["openid", "email", "profile"]
  }'
```

ผลลัพธ์ (ไม่มี `client_secret`):
```json
{
  "client_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "name": "System B SPA",
  "is_public": true,
  "redirect_uris": ["https://SYSTEM_B_DOMAIN/callback"],
  "scopes": ["openid", "email", "profile"]
}
```

### ขั้นตอนที่ 2 — ตั้งค่า Vite `.env`

```env
VITE_TENCYBER_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_TENCYBER_ISSUER=https://dashboard.tenfw.com
VITE_REDIRECT_URI=https://SYSTEM_B_DOMAIN/callback
```

### ขั้นตอนที่ 3 — ไฟล์ PKCE Helper (`src/lib/pkce.ts`)

```typescript
// src/lib/pkce.ts

/** สร้าง code_verifier แบบ random (43-128 ตัวอักษร base64url) */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** สร้าง code_challenge จาก verifier ด้วย SHA-256 → base64url */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
```

### ขั้นตอนที่ 4 — เริ่ม Login Flow (`src/lib/auth.ts`)

```typescript
// src/lib/auth.ts
import { generateCodeVerifier, generateCodeChallenge } from './pkce';

const CLIENT_ID = import.meta.env.VITE_TENCYBER_CLIENT_ID;
const ISSUER    = import.meta.env.VITE_TENCYBER_ISSUER;
const REDIRECT  = import.meta.env.VITE_REDIRECT_URI;

export async function loginWithTencyber() {
  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state     = crypto.randomUUID();           // CSRF protection

  // เก็บ verifier + state ใน sessionStorage (ไม่ใช่ localStorage)
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state',   state);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT,
    scope:                 'openid email profile',
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });

  // Redirect ผู้ใช้ไปยัง TENCYBER Authorization endpoint
  window.location.href = `${ISSUER}/api/oauth/authorize?${params.toString()}`;
}
```

### ขั้นตอนที่ 5 — รับ Callback และแลก Token (`src/pages/Callback.tsx`)

```tsx
// src/pages/Callback.tsx  (หรือ route component ที่ตรงกับ VITE_REDIRECT_URI)
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const ISSUER   = import.meta.env.VITE_TENCYBER_ISSUER;
const CLIENT_ID = import.meta.env.VITE_TENCYBER_CLIENT_ID;
const REDIRECT  = import.meta.env.VITE_REDIRECT_URI;

export default function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const params   = new URLSearchParams(window.location.search);
      const code     = params.get('code');
      const state    = params.get('state');
      const verifier = sessionStorage.getItem('pkce_verifier');
      const savedState = sessionStorage.getItem('oauth_state');

      // CSRF check
      if (!code || state !== savedState) {
        navigate('/login?error=invalid_state');
        return;
      }

      sessionStorage.removeItem('pkce_verifier');
      sessionStorage.removeItem('oauth_state');

      // แลก code → access_token + id_token (ไม่ต้องใช้ client_secret)
      const res = await fetch(`${ISSUER}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:   'authorization_code',
          code:         code!,
          redirect_uri: REDIRECT,
          client_id:    CLIENT_ID,
          code_verifier: verifier!,   // ← PKCE verifier แทน client_secret
        }).toString(),
      });

      if (!res.ok) {
        const err = await res.json();
        navigate(`/login?error=${err.error}`);
        return;
      }

      const { access_token, id_token } = await res.json();

      // ดึง user info
      const userRes = await fetch(`${ISSUER}/api/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const user = await userRes.json();

      // เก็บ token ใน memory store หรือ context (อย่าเก็บ access_token ใน localStorage)
      // ตัวอย่าง: ใช้ React Context หรือ Zustand
      console.log('Logged in as:', user);
      navigate('/dashboard');
    })();
  }, []);

  return <div>กำลัง login...</div>;
}
```

### ขั้นตอนที่ 6 — React Router Setup (`src/App.tsx`)

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Callback from './pages/Callback';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"     element={<Login />} />
        <Route path="/callback"  element={<Callback />} />     {/* ← ต้องตรงกับ VITE_REDIRECT_URI */}
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### สิ่งที่ TENCYBER Server ทำเพื่อรองรับ PKCE

| ขั้นตอน | สิ่งที่เกิดขึ้น |
|---------|----------------|
| `/authorize` | รับ `code_challenge` + `code_challenge_method=S256`, บันทึกไว้คู่กับ auth code |
| `/token` | public client ไม่ต้องส่ง `client_secret` แต่ต้องส่ง `code_verifier` |
| Verification | Server คำนวณ `SHA256(code_verifier)` → base64url → เปรียบเทียบกับ `code_challenge` |
| Security | ถ้า `code_verifier` ไม่ตรง → `invalid_grant: PKCE verification failed` |

---

## สรุป Checklist สำหรับ System B

### Confidential Client (Next.js / Server-side)
- [ ] ได้รับ `client_id` และ `client_secret` จาก TENCYBER Admin
- [ ] ติดตั้ง NextAuth.js (หรือ OAuth2 library ของ framework ที่ใช้)
- [ ] สร้างไฟล์ `app/api/auth/[...nextauth]/route.ts`
- [ ] เพิ่ม env vars: `TENCYBER_CLIENT_ID`, `TENCYBER_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- [ ] เพิ่ม Callback URL `https://SYSTEM_B_DOMAIN/api/auth/callback/tencyber` ให้ TENCYBER Admin ทราบ
- [ ] ทดสอบ login flow และตรวจสอบว่า user info ถูกต้อง
- [ ] ทดสอบ 2FA flow (ถ้า test user เปิด 2FA ไว้)

### Public Client SPA (Vite / React / Vue)
- [ ] ได้รับ `client_id` (ไม่มี `client_secret`) จาก TENCYBER Admin
- [ ] ตั้งค่า `VITE_TENCYBER_CLIENT_ID`, `VITE_TENCYBER_ISSUER`, `VITE_REDIRECT_URI` ใน `.env`
- [ ] สร้าง PKCE helper functions (`generateCodeVerifier`, `generateCodeChallenge`)
- [ ] เก็บ `code_verifier` + `state` ใน `sessionStorage` ก่อน redirect
- [ ] สร้าง `/callback` route เพื่อรับ code และแลก token พร้อม `code_verifier`
- [ ] ตรวจสอบ `state` ก่อนใช้ code (CSRF protection)
- [ ] ไม่เก็บ `access_token` ใน `localStorage` — ใช้ memory / sessionStorage แทน

---

## ติดต่อ

หากมีปัญหาในการเชื่อมต่อ ติดต่อ TENCYBER Admin เพื่อ:  
1. ตรวจสอบ `redirect_uri` ที่ลงทะเบียนไว้
2. Reset `client_secret` ถ้าจำเป็น (confidential client)
3. ตรวจสอบ logs ที่ TENCYBER backend

> TENCYBER Version: 2026.02  
> OAuth Standard: RFC 6749 (Authorization Code Flow) + RFC 7636 (PKCE) + OpenID Connect Core 1.0

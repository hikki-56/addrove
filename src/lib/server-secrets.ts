const MIN_SECRET_LENGTH = 32;

function normalizeSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function requireSecret(name: string, value: string | undefined): string {
  const secret = value?.trim();
  if (!secret) {
    throw new Error(`${name} is required. Configure it in the server environment.`);
  }
  if (process.env.NODE_ENV === "production" && secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters in production.`);
  }
  return secret;
}

export function getAuthSecret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "stockify-secret-key-super-secure-2026";
  const trimmed = s.trim();
  return trimmed.length < MIN_SECRET_LENGTH ? trimmed.padEnd(MIN_SECRET_LENGTH, "0") : trimmed;
}

export function getQrTokenSecret(): string {
  const qrSecret = normalizeSecret(process.env.QR_TOKEN_SECRET);
  const authSecret = normalizeSecret(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET);
  const base = (qrSecret || authSecret || "default-dev-qr-secret-key-32-chars-long").trim();
  return base.length < MIN_SECRET_LENGTH ? base.padEnd(MIN_SECRET_LENGTH, "0") : base;
}

export function getGoogleScriptSigningSecret(): string {
  const s = normalizeSecret(process.env.GOOGLE_SCRIPT_SIGNING_SECRET) || "633878d53d2786642ccacc79f1e6f0b6639a06fcd8381d408caf963dd3a98b21";
  const trimmed = s.trim();
  return trimmed.length < MIN_SECRET_LENGTH ? trimmed.padEnd(MIN_SECRET_LENGTH, "0") : trimmed;
}

export function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const authSecret = normalizeSecret(
    process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  );
  if (!authSecret) {
    errors.push("AUTH_SECRET is missing");
  } else if (process.env.NODE_ENV === "production" && authSecret.length < 32) {
    errors.push("AUTH_SECRET must be at least 32 characters in production");
  }

  const qrSecret = normalizeSecret(process.env.QR_TOKEN_SECRET);
  if (process.env.NODE_ENV === "production") {
    if (!qrSecret) {
      errors.push("QR_TOKEN_SECRET is missing in production");
    } else if (qrSecret.length < 32) {
      errors.push("QR_TOKEN_SECRET must be at least 32 characters in production");
    } else if (authSecret && qrSecret === authSecret) {
      errors.push("QR_TOKEN_SECRET must not match AUTH_SECRET");
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NODE_ENV === "production") {
    if (!appUrl) {
      errors.push("NEXT_PUBLIC_APP_URL is required in production");
    } else if (!appUrl.startsWith("https://")) {
      errors.push("NEXT_PUBLIC_APP_URL must be a valid HTTPS domain in production");
    }
  }

  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (process.env.NODE_ENV === "production" && nextAuthUrl && nextAuthUrl.includes("localhost")) {
    errors.push("NEXTAUTH_URL must not point to localhost in production");
  }

  // Check that no server secrets are exposed on client-accessible NEXT_PUBLIC_* variables
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("NEXT_PUBLIC_") && typeof value === "string") {
      const lowerVal = value.toLowerCase();
      if (
        key !== "NEXT_PUBLIC_APP_URL" &&
        (lowerVal.includes("private_key") || lowerVal.includes("begin private key") || lowerVal.includes("secret"))
      ) {
        errors.push(`Secret exposed in public environment variable ${key}`);
      }
    }
  }

  const sheetId = normalizeSecret(process.env.GOOGLE_SHEET_ID);
  if (!sheetId) {
    errors.push("GOOGLE_SHEET_ID is required for storage");
  }

  const serviceAccountEmail = normalizeSecret(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL
  );
  const serviceAccountPrivateKey = normalizeSecret(process.env.GOOGLE_PRIVATE_KEY);
  const hasServiceAccount = Boolean(
    serviceAccountEmail && serviceAccountPrivateKey
  );
  const hasScriptUrl = Boolean(process.env.GOOGLE_SCRIPT_URL?.trim());
  const scriptSigningSecret = normalizeSecret(
    process.env.GOOGLE_SCRIPT_SIGNING_SECRET
  );

  if (process.env.NODE_ENV === "production" && !hasServiceAccount && !hasScriptUrl) {
    errors.push("Google Sheets writer credentials missing (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY or GOOGLE_SCRIPT_URL)");
  }

  if (process.env.NODE_ENV === "production" && hasScriptUrl) {
    if (!scriptSigningSecret) {
      errors.push(
        "GOOGLE_SCRIPT_SIGNING_SECRET is required when GOOGLE_SCRIPT_URL is configured"
      );
    } else if (scriptSigningSecret.length < MIN_SECRET_LENGTH) {
      errors.push(
        `GOOGLE_SCRIPT_SIGNING_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`
      );
    } else {
      if (authSecret && scriptSigningSecret === authSecret) {
        errors.push("GOOGLE_SCRIPT_SIGNING_SECRET must not match AUTH_SECRET");
      }
      if (qrSecret && scriptSigningSecret === qrSecret) {
        errors.push("GOOGLE_SCRIPT_SIGNING_SECRET must not match QR_TOKEN_SECRET");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertServerEnvironment(): void {
  if (process.env.NODE_ENV === "production") {
    const { valid, errors } = validateEnvironment();
    if (!valid) {
      throw new Error(`Production environment configuration error:\n- ${errors.join("\n- ")}`);
    }
  }
}

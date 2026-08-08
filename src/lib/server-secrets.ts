const MIN_SECRET_LENGTH = 32;

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
  return requireSecret(
    "AUTH_SECRET (or NEXTAUTH_SECRET)",
    process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  );
}

export function getQrTokenSecret(): string {
  const qrSecret = process.env.QR_TOKEN_SECRET?.trim();
  const authSecret = (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET)?.trim();

  if (process.env.NODE_ENV === "production") {
    if (!qrSecret) {
      throw new Error("QR_TOKEN_SECRET is required and must be separated from AUTH_SECRET in production.");
    }
    if (qrSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(`QR_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production.`);
    }
    if (authSecret && qrSecret === authSecret) {
      throw new Error("QR_TOKEN_SECRET must be a distinct dedicated secret, different from AUTH_SECRET.");
    }
    return qrSecret;
  }

  return qrSecret || authSecret || "default-dev-qr-secret-key-32-chars-long";
}

export function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!authSecret) {
    errors.push("AUTH_SECRET is missing");
  } else if (process.env.NODE_ENV === "production" && authSecret.length < 32) {
    errors.push("AUTH_SECRET must be at least 32 characters in production");
  }

  const qrSecret = process.env.QR_TOKEN_SECRET;
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

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    errors.push("GOOGLE_SHEET_ID is required for storage");
  }

  const hasServiceAccount = Boolean(
    (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL) &&
      process.env.GOOGLE_PRIVATE_KEY
  );
  const hasScriptUrl = Boolean(process.env.GOOGLE_SCRIPT_URL);

  if (process.env.NODE_ENV === "production" && !hasServiceAccount && !hasScriptUrl) {
    errors.push("Google Sheets writer credentials missing (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY or GOOGLE_SCRIPT_URL)");
  }

  if (process.env.NODE_ENV === "production" && hasScriptUrl) {
    const scriptSigningSecret = process.env.GOOGLE_SCRIPT_SIGNING_SECRET;
    if (!scriptSigningSecret) {
      errors.push("GOOGLE_SCRIPT_SIGNING_SECRET is required when GOOGLE_SCRIPT_URL is set in production");
    } else if (scriptSigningSecret.length < 32) {
      errors.push("GOOGLE_SCRIPT_SIGNING_SECRET must be at least 32 characters");
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


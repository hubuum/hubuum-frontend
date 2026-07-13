const configuredVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();

export const APPLICATION_VERSION = configuredVersion || "v0.0.0+unknown";

export default {
  hubuum: {
    input: "./openapi.json",
    output: {
      target: "./src/lib/api/generated/client.ts",
      schemas: "./src/lib/api/generated/models",
      client: "fetch",
      mode: "split"
    }
  }
};

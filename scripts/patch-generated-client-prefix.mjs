import { readFileSync, writeFileSync } from "node:fs";

const clientPath = "src/lib/api/generated/client.ts";
const prefixImport = "import { HUBUUM_BFF_PREFIX } from '@/lib/api/frontend';";

let source = readFileSync(clientPath, "utf8");

source = source.replace(
	'\nconst HUBUUM_BFF_PREFIX = "/_hubuum-bff/hubuum";\n',
	"\n",
);

if (!source.includes(prefixImport)) {
	source = source.replace(
		"} from './models';\n",
		`} from './models';\n${prefixImport}\n`,
	);
}

source = source.replace(
	/`\/api\/v([01])([^`]*)`/g,
	(_match, version, rest) =>
		["`", "${", "HUBUUM_BFF_PREFIX", "}/api/v", version, rest, "`"].join(""),
);

writeFileSync(clientPath, source);

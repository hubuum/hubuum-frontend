import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfigurationHistory } from "@/components/configuration-history";
import { requireServerSession } from "@/lib/auth/guards";
export default async function RemoteTargetHistoryPage({
	params,
}: {
	params: Promise<{ targetId: string }>;
}) {
	await requireServerSession();
	const { targetId } = await params;
	const id = Number(targetId);
	if (!/^[1-9]\d*$/.test(targetId) || !Number.isSafeInteger(id)) notFound();
	return (
		<section className="stack">
			<header>
				<h2>Remote target #{id} history</h2>
				<Link className="link-chip" href="/admin/remote-targets">
					Back to remote targets
				</Link>
			</header>
			<ConfigurationHistory kind="remote_target" id={id} />
		</section>
	);
}

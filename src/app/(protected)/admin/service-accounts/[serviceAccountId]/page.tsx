import { notFound } from "next/navigation";

import { ServiceAccountDetail } from "@/components/service-account-detail";
import { requireServerSession } from "@/lib/auth/guards";

type PageProps = {
	params: Promise<{ serviceAccountId: string }>;
};

function parseId(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return null;
	}
	return parsed;
}

export default async function AdminServiceAccountDetailPage({
	params,
}: PageProps) {
	await requireServerSession();
	const { serviceAccountId } = await params;
	const parsed = parseId(serviceAccountId);

	if (parsed === null) {
		notFound();
	}

	return (
		<section className="stack">
			<ServiceAccountDetail serviceAccountId={parsed} />
		</section>
	);
}

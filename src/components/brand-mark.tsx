import Link from "next/link";

type BrandMarkProps = {
	compact?: boolean;
	href?: string;
};

function BrandGlyph() {
	return (
		<span className="brand-glyph" aria-hidden="true">
			<svg viewBox="0 0 40 40" fill="none">
				<title>Hubuum graph mark</title>
				<path d="M9 11.5 20 5l11 6.5v17L20 35 9 28.5z" />
				<path d="m9 11.5 11 6.4 11-6.4M20 17.9V35" />
				<circle cx="9" cy="11.5" r="2.25" />
				<circle cx="31" cy="11.5" r="2.25" />
				<circle cx="20" cy="17.9" r="2.25" />
				<circle cx="20" cy="35" r="2.25" />
			</svg>
		</span>
	);
}

function BrandContents({ compact }: Pick<BrandMarkProps, "compact">) {
	return (
		<>
			<BrandGlyph />
			{compact ? null : (
				<span className="brand-copy" aria-hidden="true">
					<span className="brand-name">Hubuum</span>
					<span className="brand-product">Console</span>
				</span>
			)}
		</>
	);
}

export function BrandMark({ compact = false, href }: BrandMarkProps) {
	const className = `brand-lockup${compact ? " brand-lockup--compact" : ""}`;

	if (href) {
		return (
			<Link className={className} href={href} aria-label="Hubuum Console home">
				<BrandContents compact={compact} />
			</Link>
		);
	}

	return (
		<div className={className}>
			<BrandContents compact={compact} />
			<span className="sr-only">Hubuum Console</span>
		</div>
	);
}

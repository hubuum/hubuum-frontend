import Link from "next/link";

export type BreadcrumbItem = {
	label: string;
	href?: string;
};

type BreadcrumbsProps = {
	items: BreadcrumbItem[];
};

export function Breadcrumbs({ items }: BreadcrumbsProps) {
	if (items.length === 0) {
		return null;
	}

	return (
		<nav className="breadcrumbs" aria-label="Breadcrumb">
			<ol>
				{items.map((item, index) => {
					const isCurrent = index === items.length - 1 || !item.href;
					return (
						<li key={item.href ?? `current-${item.label}`}>
							{isCurrent ? (
								<span aria-current={index === items.length - 1 ? "page" : undefined}>
									{item.label}
								</span>
							) : (
								<Link href={item.href ?? "#"}>{item.label}</Link>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

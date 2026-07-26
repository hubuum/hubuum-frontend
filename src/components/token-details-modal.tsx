"use client";

import {
	CreateModal,
	type ModalRecordNavigation,
} from "@/components/create-modal";
import { JsonViewer } from "@/components/json-viewer";
import type { PrincipalTokenMetadata } from "@/lib/api/generated/models";
import type { TokenResourceNameMap } from "@/lib/api/token-resource-names";
import { tokenResourceScopeKey } from "@/lib/token-resource-scope-selection";
import {
	formatTokenMetadataScope,
	groupTokenResourceScopes,
} from "@/lib/token-scope-details";

type TokenDetailsModalProps = {
	token: PrincipalTokenMetadata | null;
	onClose: () => void;
	navigation?: ModalRecordNavigation;
	resourceNames?: TokenResourceNameMap;
	resourceNamesLoading?: boolean;
	unresolvedResourceNames?: number;
};

const RESOURCE_GROUPS = [
	{ kind: "collection", label: "Collections" },
	{ kind: "class", label: "Classes" },
	{ kind: "object", label: "Objects" },
] as const;

function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "Not recorded";
	}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "long",
	}).format(parsed);
}

export function TokenDetailsModal({
	token,
	onClose,
	navigation,
	resourceNames = {},
	resourceNamesLoading = false,
	unresolvedResourceNames = 0,
}: TokenDetailsModalProps) {
	const scope = token?.scope;
	const permissions = scope?.permissions;
	const resources = scope?.resources;
	const resourcesByKind = groupTokenResourceScopes(resources);
	const hasObjectScopeWithoutClass =
		resourcesByKind.object.length > 0 && resourcesByKind.class.length === 0;

	return (
		<CreateModal
			open={token !== null}
			title={token ? `Token #${token.id}` : "Token"}
			onClose={onClose}
			navigation={navigation}
		>
			{token ? (
				<div className="stack">
					<div className="token-detail-intro">
						<div>
							<strong>{token.name ?? "Unnamed token"}</strong>
							<p className="muted">
								{token.description ?? "No description was recorded."}
							</p>
						</div>
						<span className="status-pill">
							{token.revoked_at ? "Revoked" : "Active"}
						</span>
					</div>

					<dl className="event-detail-grid">
						<div>
							<dt>Principal</dt>
							<dd>#{token.principal_id}</dd>
						</div>
						<div>
							<dt>Scope summary</dt>
							<dd>{formatTokenMetadataScope(token)}</dd>
						</div>
						<div>
							<dt>Issued</dt>
							<dd>{formatTimestamp(token.issued)}</dd>
						</div>
						<div>
							<dt>Explicit expiry</dt>
							<dd>
								{token.expires_at
									? formatTimestamp(token.expires_at)
									: "Server default lifetime"}
							</dd>
						</div>
						<div>
							<dt>Last used</dt>
							<dd>{formatTimestamp(token.last_used_at)}</dd>
						</div>
						<div>
							<dt>Revoked</dt>
							<dd>
								{token.revoked_at
									? formatTimestamp(token.revoked_at)
									: "Not revoked"}
							</dd>
						</div>
					</dl>

					<section className="stack token-detail-scope">
						<div className="token-detail-section-header">
							<div>
								<h4>Token boundaries</h4>
								<p className="muted">
									Effective authority is the intersection of these boundaries
									and the principal&apos;s current group grants.
								</p>
							</div>
							<span className="badge">{scope ? "Scoped" : "Unscoped"}</span>
						</div>

						{!scope ? (
							<div className="token-detail-unrestricted">
								This token has no token-specific permission or resource
								boundary.
							</div>
						) : (
							<div className="token-detail-scope-grid">
								<section className="permission-section">
									<div className="token-detail-section-header">
										<h5 className="permission-section-title">
											Permission boundary
										</h5>
										<span className="badge">
											{permissions == null
												? "Unrestricted"
												: `${permissions.length} selected`}
										</span>
									</div>
									{permissions == null ? (
										<p className="muted">
											All permissions available through the principal&apos;s
											live grants.
										</p>
									) : permissions.length === 0 ? (
										<p className="muted">No permissions selected.</p>
									) : (
										<ul className="chip-row token-detail-chip-list">
											{permissions.map((permission) => (
												<li className="badge" key={permission}>
													<code>{permission}</code>
												</li>
											))}
										</ul>
									)}
								</section>

								<section className="permission-section">
									<div className="token-detail-section-header">
										<h5 className="permission-section-title">
											Resource boundary
										</h5>
										<span className="badge">
											{resources == null
												? "Unrestricted"
												: `${resources.length} selected`}
										</span>
									</div>
									{resources == null ? (
										<p className="muted">
											All resources available through the principal&apos;s live
											grants.
										</p>
									) : resources.length === 0 ? (
										<p className="muted">No resources selected.</p>
									) : (
										<div className="stack token-detail-resource-groups">
											{RESOURCE_GROUPS.map(({ kind, label }) =>
												resourcesByKind[kind].length > 0 ? (
													<div className="stack" key={kind}>
														<strong>
															{label}{" "}
															<span className="muted">
																({resourcesByKind[kind].length})
															</span>
														</strong>
														<ul className="chip-row token-detail-chip-list">
															{resourcesByKind[kind].map((resource) => (
																<li
																	className="badge token-detail-resource"
																	key={`${resource.kind}:${resource.id}`}
																>
																	<span>
																		{resourceNames[
																			tokenResourceScopeKey(resource)
																		] ??
																			(resourceNamesLoading
																				? "Resolving name..."
																				: "Name unavailable")}
																	</span>
																	<span className="muted">
																		(#{resource.id})
																	</span>
																</li>
															))}
														</ul>
													</div>
												) : null,
											)}
											{resourceNamesLoading ? (
												<small className="muted">
													Resolving scoped resource names...
												</small>
											) : unresolvedResourceNames > 0 ? (
												<small className="field-error">
													{hasObjectScopeWithoutClass
														? "An object resource must belong to one of the class entries in the same scope. "
														: `Could not resolve ${unresolvedResourceNames} resource ${
																unresolvedResourceNames === 1
																	? "name"
																	: "names"
															}. `}
													The exact IDs are retained.
												</small>
											) : null}
										</div>
									)}
								</section>
							</div>
						)}
					</section>

					<p className="muted token-detail-security-note">
						The raw bearer token and its stored hash are never returned by the
						token-list API.
					</p>

					<details className="event-detail-raw">
						<summary>View complete token metadata</summary>
						<div className="event-detail-json">
							<JsonViewer value={token} />
						</div>
					</details>
				</div>
			) : null}
		</CreateModal>
	);
}

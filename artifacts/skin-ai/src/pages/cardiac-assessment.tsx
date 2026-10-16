import { Link } from "wouter";
import { useGetCardiacModelStatus } from "@workspace/api-client-react";
import { Activity, AlertTriangle, ArrowLeft, HeartPulse } from "lucide-react";
import { Layout } from "@/components/layout";

type CardiacContract = {
  task?: string;
  dataset?: { id?: string; sourceUrl?: string; licenseNote?: string; knownLimitations?: string[] };
  features?: Array<{ name: string; type: string; unit: string | null; description: string; allowedValues?: string[]; minimum?: number; maximum?: number }>;
  preprocessingNote?: string;
};

export default function CardiacAssessment() {
  const statusQuery = useGetCardiacModelStatus();
  const status = statusQuery.data;
  const contract = (status?.contract ?? {}) as CardiacContract;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pt-8 pb-20">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6">
          <ArrowLeft className="w-4 h-4" />Back to Overview
        </Link>

        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Cardiac Assessment</h1>
          <p className="text-slate-600 mt-2 max-w-3xl">
            This module would estimate heart-disease risk from structured clinical inputs. It ships without a trained model, so it reports its
            availability honestly instead of guessing.
          </p>
        </div>

        {statusQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Checking cardiac model availability…</p>}
        {statusQuery.isError && (
          <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <h2 className="text-xl font-semibold">Status unavailable</h2>
            <p className="mt-2 text-sm text-slate-600">The cardiac model status could not be loaded. Retry shortly.</p>
          </section>
        )}

        {status && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-red-200 bg-red-50 p-6">
              <div className="flex items-start gap-3 text-red-900">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <h2 className="font-semibold">No cardiac model is available</h2>
                  <p className="mt-1 text-sm">{status.reason}</p>
                  <p className="mt-2 text-sm">
                    Chest pain, shortness of breath, or other possible heart symptoms can be life-threatening. Contact local emergency services
                    immediately rather than waiting for any software result.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <HeartPulse className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Why there is no result</h2>
              </div>
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                <li>No trained and verified heart-disease model artifact exists in this repository, so no prediction can be produced.</li>
                <li>Uploading a cardiac image or entering numbers here would not change that — the application does not fabricate model output.</li>
                <li>The contract below documents exactly what a future model would need to satisfy before it could be enabled.</li>
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Future model contract{contract.dataset?.id ? ` · ${contract.dataset.id}` : ""}</h2>
              </div>
              {contract.task && <p className="mb-4 text-sm text-slate-600">Task: {contract.task.replace(/-/g, " ")}</p>}
              {Array.isArray(contract.features) && contract.features.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Input</th>
                        <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Range / values</th>
                        <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {contract.features.map((feature) => (
                        <tr key={feature.name}>
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{feature.name}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{feature.type}{feature.unit ? ` (${feature.unit})` : ""}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {feature.allowedValues?.length
                              ? feature.allowedValues.join(", ")
                              : feature.minimum !== undefined && feature.maximum !== undefined
                                ? `${feature.minimum}–${feature.maximum}`
                                : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{feature.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {contract.dataset?.knownLimitations && contract.dataset.knownLimitations.length > 0 && (
                <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                  <h3 className="font-semibold">Known limitations of the dataset this contract references</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {contract.dataset.knownLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
                  </ul>
                </div>
              )}
              {contract.preprocessingNote && <p className="mt-4 text-xs text-slate-500">{contract.preprocessingNote}</p>}
              {contract.dataset?.sourceUrl && (
                <p className="mt-2 text-xs text-slate-500">
                  Dataset reference: <a className="text-primary hover:underline" href={contract.dataset.sourceUrl} target="_blank" rel="noreferrer noopener">{contract.dataset.sourceUrl}</a>
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </Layout>
  );
}

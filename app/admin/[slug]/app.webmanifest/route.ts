import { studioManifest } from "@/lib/manifest";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return studioManifest(slug, "admin");
}

import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  const slug = request.nextUrl.searchParams.get("slug");

  if (!secret || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ message: "Invalid secret" }, { status: 401 });
  }

  revalidatePath("/luxury-life-guides");
  if (slug) {
    revalidatePath(`/luxury-life-guides/${slug}`);
  } else {
    revalidatePath("/luxury-life-guides", "layout");
  }

  return NextResponse.json({
    revalidated: true,
    slug: slug || "hub",
    now: Date.now(),
  });
}

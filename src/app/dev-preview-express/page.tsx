import ExpressIssuePage from "@/app/(dashboard)/express-import/issue/page";

export default function DevPreviewExpressPage() {
  return (
    <main className="min-h-screen bg-[#EFF3F1] px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-[1500px]">
        <ExpressIssuePage />
      </div>
    </main>
  );
}

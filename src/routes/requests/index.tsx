import { CollectionsSidebar } from "@/components/collections/CollectionsSidebar";
import { RequestPanel } from "@/components/request/RequestPanel";
import { ResponsePanel } from "@/components/response/ResponsePanel";

export function RequestsRoute() {
  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <CollectionsSidebar />
      <RequestPanel />
      <ResponsePanel />
    </div>
  );
}

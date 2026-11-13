import { api } from "@/lib/api/client";
import { CameraForm, type CameraFormTransport } from "@/components/CameraForm/CameraForm";

/**
 * Endpoint dialog wrapper: the shared camera form bound to the endpoint's
 * camera via the endpoint adapter routes, so Live talk keeps working unchanged.
 */
export const CameraSettings = ({ endpointId }: { endpointId: number }) => {
  const transport: CameraFormTransport = {
    load: () => api.camera.get(endpointId),
    save: (body) => api.camera.save(endpointId, body),
    test: (cfg) => api.camera.test(endpointId, cfg),
    remove: () => api.camera.remove(endpointId),
    snapshotUrl: api.camera.snapshotUrl(endpointId),
  };

  return <CameraForm transport={transport} />;
};

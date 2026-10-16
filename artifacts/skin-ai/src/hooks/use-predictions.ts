import { useQueryClient } from "@tanstack/react-query";
import { 
  usePredictSkinDisease, 
  useGetPredictionHistory, 
  useGetPredictionById,
  getGetPredictionHistoryQueryKey
} from "@workspace/api-client-react";

// Wrapper for the prediction history query to provide clean imports
export function useHistory(page = 1) {
  return useGetPredictionHistory({ page, limit: 20 });
}

// Wrapper for the single prediction query
export function usePrediction(id: number) {
  return useGetPredictionById(id, {
    query: {
      enabled: Number.isSafeInteger(id) && id > 0,
      queryKey: [`/api/predictions/${id}`],
    }
  });
}

// Wrapper for the mutation that automatically invalidates the history cache
export function useAnalyzeSkin() {
  const queryClient = useQueryClient();
  
  return usePredictSkinDisease({
    mutation: {
      onSuccess: () => {
        // Invalidate history so it refetches when the user goes to the history page
        queryClient.invalidateQueries({
          queryKey: getGetPredictionHistoryQueryKey()
        });
      }
    }
  });
}

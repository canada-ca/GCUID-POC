/*!
 * GCUID — Government of Canada Unique Identifier System
 *
 * @license
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 * Author: Philippe R. Beauchamp <prb@noetroniq.com>
 *
 * Licensed for use and modification by the Treasury Board of Canada Secretariat.
 * See LICENSE in the project root for full terms.
 */
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

export default function LoadingSpinner({ size = 'md', message }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <div role="status" aria-live="polite" aria-label={message ?? 'Loading'} className="flex flex-col items-center justify-center p-8">
      <div className={`motion-safe:animate-spin rounded-full border-b-2 border-ux-accent ${sizeClasses[size]}`} />
      {message && <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">{message}</p>}
    </div>
  );
}

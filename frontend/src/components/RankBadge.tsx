import React from 'react';

interface RankBadgeProps {
  rank: number;
  size?: 'sm' | 'md' | 'lg';
}

const RankBadge: React.FC<RankBadgeProps> = ({ rank, size = 'md' }) => {
  const getRankEmoji = (rank: number): string => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  };

  const getRankColor = (rank: number): string => {
    if (rank === 1) return 'text-yellow-500';
    if (rank === 2) return 'text-gray-400';
    if (rank === 3) return 'text-orange-600';
    return '';
  };

  const sizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl',
  };

  const emoji = getRankEmoji(rank);
  const colorClass = getRankColor(rank);

  if (!emoji) return null;

  return (
    <span className={`${sizeClasses[size]} ${colorClass} inline-block ml-1`} title={`Rank #${rank}`}>
      {emoji}
    </span>
  );
};

export default RankBadge;


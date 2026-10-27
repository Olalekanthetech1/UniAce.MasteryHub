import { PastPaper } from '../components/SkillPracticeHub';
import { QuizQuestion } from '../types';

export function findRelevantQuestions(query: string, pastPapers: PastPaper[], limit: number = 3): QuizQuestion[] {
  const queryTerms = query.toLowerCase().split(' ').filter(term => term.length > 3);
  
  if (queryTerms.length === 0) return [];

  const allQuestions: QuizQuestion[] = [];
  pastPapers.forEach(paper => {
    allQuestions.push(...(paper.questions as QuizQuestion[]));
  });

  const scoredQuestions = allQuestions.map(question => {
    let score = 0;
    const content = (question.question + " " + question.explanation).toLowerCase();
    
    queryTerms.forEach(term => {
      if (content.includes(term)) {
        score++;
      }
    });
    
    return { question, score };
  });

  return scoredQuestions
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.question);
}

import { Module, Formula, Course, Department, Level, Semester } from './types';

export const MAT103_FORMULAS: Formula[] = [
  { id: 'f-unit-vec', title: 'Unit Vector', latex: '\\hat{a} = \\frac{\\vec{a}}{|\\vec{a}|}', description: 'A vector with a magnitude of 1 in the direction of $\\vec{a}$.', category: 'Vectors' },
  { id: 'f-vec-mag', title: 'Vector Magnitude', latex: '|\\vec{a}| = \\sqrt{x^2 + y^2 + z^2}', description: 'The magnitude of a vector $\\vec{a} = x\\hat{i} + y\\hat{j} + z\\hat{k}$.', category: 'Vectors' },
  { id: 'f-dot-prod', title: 'Scalar (Dot) Product', latex: '\\vec{a} \\cdot \\vec{b} = |\\vec{a}||\\vec{b}| \\cos \\theta', description: 'The product of the magnitudes and the cosine of the angle between them.', category: 'Vectors' },
  { id: 'f-cross-prod', title: 'Vector (Cross) Product', latex: '\\vec{a} \\times \\vec{b} = |\\vec{a}||\\vec{b}| \\sin \\theta \\hat{n}', description: 'A vector perpendicular to both $\\vec{a}$ and $\\vec{b}$.', category: 'Vectors' },
  { id: 'f-scalar-triple', title: 'Scalar Triple Product', latex: '\\vec{a} \\cdot (\\vec{b} \\times \\vec{c})', description: 'The volume of the parallelepiped defined by vectors $\\vec{a}, \\vec{b}, \\vec{c}$.', category: 'Vectors' },
  { id: 'f-dist', title: 'Distance Formula', latex: 'd = \\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}', description: 'The distance between two points in a 2D plane.', category: 'Geometry' },
  { id: 'f-line-eq', title: 'Straight Line Equation', latex: 'y - y_1 = m(x - x_1)', description: 'Point-slope form of a straight line equation.', category: 'Geometry' },
  { id: 'f-circle', title: 'Circle Equation', latex: '(x-x_c)^2 + (y-y_c)^2 = r^2', description: 'Standard equation of a circle with center $(x_c, y_c)$ and radius $r$.', category: 'Geometry' },
  { id: 'f-parabola', title: 'Parabola Equation', latex: 'y^2 = 4ax', description: 'Standard equation of a parabola opening to the right.', category: 'Geometry' },
  { id: 'f-ellipse', title: 'Ellipse Equation', latex: '\\frac{x^2}{a^2} + \\frac{y^2}{b^2} = 1', description: 'Standard equation of an ellipse.', category: 'Geometry' },
  { id: 'f-motion-1', title: 'First Equation of Motion', latex: 'v = u + at', description: 'Relates final velocity, initial velocity, acceleration, and time.', category: 'Motion' },
  { id: 'f-motion-2', title: 'Displacement Formula', latex: 's = ut + \\frac{1}{2}at^2', description: 'Calculates displacement under constant acceleration.', category: 'Motion' },
  { id: 'f-force', title: 'Newton\'s Second Law', latex: 'F = ma', description: 'Relates force, mass, and acceleration.', category: 'Motion' },
  { id: 'f-momentum', title: 'Conservation of Momentum', latex: 'm_1u_1 + m_2u_2 = m_1v_1 + m_2v_2', description: 'Total momentum before collision equals total momentum after collision.', category: 'Motion' },
];

export const MAT101_FORMULAS: Formula[] = [
  { id: 'f-set-union', title: 'Set Union', latex: 'A \\cup B = \\{x | x \\in A \\text{ or } x \\in B\\}', description: 'The union of two sets.', category: 'Algebra' },
  { id: 'f-quad', title: 'Quadratic Formula', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', description: 'Solutions to $ax^2 + bx + c = 0$.', category: 'Algebra' },
  { id: 'f-log-prod', title: 'Logarithm Product Rule', latex: '\\log_b(xy) = \\log_b(x) + \\log_b(y)', description: 'The logarithm of a product is the sum of the logarithms.', category: 'Algebra' },
  { id: 'f-binom', title: 'Binomial Theorem', latex: '(x+y)^n = \\sum_{k=0}^{n} \\binom{n}{k} x^{n-k} y^k', description: 'Expansion of a binomial power.', category: 'Algebra' },
];

export const MAT102_FORMULAS: Formula[] = [
  { id: 'f-deriv-prod', title: 'Product Rule', latex: '\\frac{d}{dx}[f(x)g(x)] = f\'(x)g(x) + f(x)g\'(x)', description: 'Derivative of a product of two functions.', category: 'Calculus' },
  { id: 'f-deriv-chain', title: 'Chain Rule', latex: '\\frac{d}{dx}[f(g(x))] = f\'(g(x))g\'(x)', description: 'Derivative of a composite function.', category: 'Calculus' },
  { id: 'f-int-parts', title: 'Integration by Parts', latex: '\\int u \\, dv = uv - \\int v \\, du', description: 'A technique for integrating the product of two functions.', category: 'Calculus' },
  { id: 'f-u-sub', title: 'U-Substitution', latex: '\\int f(g(x))g\'(x) dx = \\int f(u) du', description: 'Technique for integration by change of variables.', category: 'Calculus' },
];

export const MAT102_SYLLABUS: Module[] = [
  {
    id: 'limits',
    title: '1. LIMITS & CONTINUITY',
    subTopics: [
      { id: '1.1', title: '1.1 Introduction to Limits', content: '### 1.1 Introduction to Limits\nLimits describe the behavior of a function as the input approaches a certain value.' }
    ]
  },
  {
    id: 'diff-tech',
    title: '2. DIFFERENTIATION TECHNIQUES',
    subTopics: [
      { id: '2.1', title: '2.1 First Principles', content: '### 2.1 First Principles\nDefinition of derivative as a limit.' }
    ]
  },
  {
    id: 'transcendental',
    title: '3. TRANSCENDENTAL DERIVATIVES',
    subTopics: [
      { id: '3.1', title: '3.1 Derivatives of Trig/Log/Exp', content: '### 3.1 Derivatives of Trig/Log/Exp\nRules for $\\sin x, \\ln x, e^x$.' }
    ]
  },
  {
    id: 'app-deriv-1',
    title: '4. APPLICATIONS OF DERIVATIVES I',
    subTopics: [
      { id: '4.1', title: '4.1 Optimization', content: '### 4.1 Optimization\nFinding maxima and minima.' }
    ]
  },
  {
    id: 'indef-int',
    title: '5. INDEFINITE INTEGRATION',
    subTopics: [
      { id: '5.1', title: '5.1 U-Substitution', content: '### 5.1 U-Substitution\nTechnique for integration.' }
    ]
  },
  {
    id: 'def-int',
    title: '6. DEFINITE INTEGRALS & APPLICATIONS',
    subTopics: [
      { id: '6.1', title: '6.1 Area Under Curve', content: '### 6.1 Area Under Curve\nFundamental Theorem of Calculus.' }
    ]
  },
  {
    id: 'coord-geom',
    title: '7. COORDINATE GEOMETRY (2D)',
    subTopics: [
      { id: '7.1', title: '7.1 Conic Sections', content: '### 7.1 Conic Sections\nLines, circles, parabolas, ellipses.' }
    ]
  }
];

export const STA112_FORMULAS: Formula[] = [
  { id: 'f-prob-union', title: 'Addition Law', latex: 'P(A \\cup B) = P(A) + P(B) - P(A \\cap B)', description: 'Probability of either event A or B occurring.', category: 'Probability' },
  { id: 'f-cond-prob', title: 'Conditional Probability', latex: 'P(A|B) = \\frac{P(A \\cap B)}{P(B)}', description: 'Probability of A given that B has occurred.', category: 'Probability' },
  { id: 'f-bayes', title: 'Bayes\' Theorem', latex: 'P(A|B) = \\frac{P(B|A)P(A)}{P(B)}', description: 'Relates conditional and marginal probabilities.', category: 'Probability' },
  { id: 'f-expect', title: 'Expected Value', latex: 'E[X] = \\sum_{i} x_i P(x_i)', description: 'The long-term average value of a random variable.', category: 'Statistics' },
  { id: 'f-var', title: 'Variance', latex: 'Var(X) = E[X^2] - (E[X])^2', description: 'Measure of the spread of a random variable.', category: 'Statistics' },
  { id: 'f-std-dev', title: 'Standard Deviation', latex: '\\sigma = \\sqrt{Var(X)}', description: 'Square root of the variance.', category: 'Statistics' },
];

export const BIO101_FORMULAS: Formula[] = [
  { id: 'f-hardy-w', title: 'Hardy-Weinberg Equilibrium', latex: 'p^2 + 2pq + q^2 = 1', description: 'Relates allele frequencies in a population.', category: 'Genetics' },
  { id: 'f-cell-resp', title: 'Cellular Respiration', latex: 'C_6H_{12}O_6 + 6O_2 \\rightarrow 6CO_2 + 6H_2O + ATP', description: 'The chemical process of energy production.', category: 'Metabolism' },
  { id: 'f-photo', title: 'Photosynthesis', latex: '6CO_2 + 6H_2O + \\text{light} \\rightarrow C_6H_{12}O_6 + 6O_2', description: 'Conversion of light energy to chemical energy.', category: 'Metabolism' },
];

export const BIO102_FORMULAS: Formula[] = [
  { id: 'f-pop-growth', title: 'Population Growth', latex: '\\frac{dN}{dt} = rN', description: 'Exponential growth of a population.', category: 'Ecology' },
];

export const BIO107_FORMULAS: Formula[] = [
  { id: 'f-gen-time', title: 'Generation Time', latex: 'G = \\frac{t}{n}', description: 'Time taken for a population to double.', category: 'Microbiology' },
];

export const BIO108_FORMULAS: Formula[] = [
  { id: 'f-cardiac-out', title: 'Cardiac Output', latex: 'CO = HR \\times SV', description: 'Volume of blood pumped by the heart per minute.', category: 'Physiology' },
];

export const PHY101_FORMULAS: Formula[] = [
  { id: 'f-work', title: 'Work Done', latex: 'W = Fd \\cos \\theta', description: 'The product of force and displacement.', category: 'Mechanics' },
  { id: 'f-kinetic', title: 'Kinetic Energy', latex: 'K.E = \\frac{1}{2}mv^2', description: 'Energy possessed by a body in motion.', category: 'Mechanics' },
  { id: 'f-potential', title: 'Potential Energy', latex: 'P.E = mgh', description: 'Energy possessed by a body due to its position.', category: 'Mechanics' },
];

export const PHY102_FORMULAS: Formula[] = [
  { id: 'f-coulomb', title: "Coulomb's Law", latex: 'F = k \\frac{|q_1 q_2|}{r^2}', description: 'Electrostatic force between two point charges.', category: 'Electricity' },
  { id: 'f-electric-field', title: 'Electric Field', latex: 'E = \\frac{F}{q}', description: 'Electric force per unit charge.', category: 'Electricity' },
  { id: 'f-ohm', title: "Ohm's Law", latex: 'V = IR', description: 'Voltage across a conductor is proportional to current.', category: 'Electricity' },
];

export const PHY103_FORMULAS: Formula[] = [
  { id: 'f-density', title: 'Density', latex: '\\rho = \\frac{m}{V}', description: 'Mass per unit volume.', category: 'Properties of Matter' },
  { id: 'f-pressure', title: 'Pressure', latex: 'P = \\frac{F}{A}', description: 'Force per unit area.', category: 'Properties of Matter' },
  { id: 'f-hooke', title: "Hooke's Law", latex: 'F = -kx', description: 'Restoring force is proportional to extension.', category: 'Properties of Matter' },
];

export const PHY107_SYLLABUS: Module[] = [];

export const PHY107_FORMULAS: Formula[] = [
  { id: 'f-error', title: 'Percentage Error', latex: '\\% \\text{Error} = \\frac{|\\text{Exp} - \\text{Theo}|}{\\text{Theo}} \\times 100', description: 'Measure of accuracy in experimental results.', category: 'Laboratory' },
];

export const PHY108_FORMULAS: Formula[] = [
  { id: 'f-refractive', title: 'Refractive Index', latex: 'n = \\frac{\\sin i}{\\sin r}', description: 'Ratio of the sine of angle of incidence to the sine of angle of refraction.', category: 'Optics' },
];

export const PHY104_FORMULAS: Formula[] = [
  { id: 'f-rel-time', title: 'Time Dilation', latex: 't = \\frac{t_0}{\\sqrt{1 - v^2/c^2}}', description: 'Time interval measured by an observer in motion.', category: 'Relativity' },
  { id: 'f-rel-mass', title: 'Mass-Energy Equivalence', latex: 'E = mc^2', description: 'Relationship between mass and energy.', category: 'Relativity' },
  { id: 'f-photon-e', title: 'Photon Energy', latex: 'E = hf', description: 'Energy of a photon related to its frequency.', category: 'Quantum' },
];

export const CHM101_FORMULAS: Formula[] = [
  { id: 'f-ideal-gas', title: 'Ideal Gas Law', latex: 'PV = nRT', description: 'Relates pressure, volume, temperature, and number of moles of a gas.', category: 'Physical Chemistry' },
  { id: 'f-molarity', title: 'Molarity', latex: 'M = \\frac{n}{V}', description: 'Concentration of a solution in moles per liter.', category: 'Physical Chemistry' },
  { id: 'f-ph', title: 'pH Definition', latex: '\\text{pH} = -\\log[H^+]', description: 'Measure of the acidity or basicity of an aqueous solution.', category: 'Physical Chemistry' },
];

export const CHM102_FORMULAS: Formula[] = [
  { id: 'f-gibbs', title: 'Gibbs Free Energy', latex: '\\Delta G = \\Delta H - T\\Delta S', description: 'Determines the spontaneity of a process.', category: 'Thermodynamics' },
  { id: 'f-equilibrium', title: 'Equilibrium Constant', latex: 'K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}', description: 'Ratio of product concentrations to reactant concentrations at equilibrium.', category: 'Physical Chemistry' },
];

export const CHM107_FORMULAS: Formula[] = [
  { id: 'f-titration', title: 'Titration Equation', latex: '\\frac{C_aV_a}{n_a} = \\frac{C_bV_b}{n_b}', description: 'Relationship between concentration and volume in acid-base titration.', category: 'Laboratory' },
];

export const CHM108_FORMULAS: Formula[] = [
  { id: 'f-beer-lambert', title: 'Beer-Lambert Law', latex: 'A = \\epsilon cl', description: 'Relates absorbance of light to the properties of the material.', category: 'Laboratory' },
];

export const COS101_FORMULAS: Formula[] = [
  { id: 'f-binary-conv', title: 'Binary Conversion', latex: 'N = \\sum_{i=0}^{n} d_i \\times 2^i', description: 'Conversion of binary digits to decimal.', category: 'Computing' },
  { id: 'f-storage', title: 'Storage Capacity', latex: 'S = n \\times 2^{10k}', description: 'Calculates storage size in KB, MB, GB, etc.', category: 'Computing' },
];

export const COS102_FORMULAS: Formula[] = [
  { id: 'f-complexity', title: 'Big O Notation', latex: 'T(n) = O(f(n))', description: 'Describes the upper bound of algorithm complexity.', category: 'Algorithms' },
];

export const GST111_FORMULAS: Formula[] = [
  { id: 'f-sentence', title: 'Sentence Structure', latex: 'S + V + (O)', description: 'Basic structure of an English sentence: Subject + Verb + Object.', category: 'Grammar' },
  { id: 'f-concord', title: 'Subject-Verb Concord', latex: 'S_{sing} \rightarrow V_{sing}, S_{pl} \rightarrow V_{pl}', description: 'Agreement between the subject and the verb in number.', category: 'Grammar' },
];

export const GST112_FORMULAS: Formula[] = [
  { id: 'f-syllogism', title: 'Categorical Syllogism', latex: 'P_1 + P_2 \rightarrow C', description: 'Logical argument where a conclusion is drawn from two premises.', category: 'Logic' },
];

export const GET101_FORMULAS: Formula[] = [
  { id: 'f-stress', title: 'Stress', latex: '\\sigma = \\frac{F}{A}', description: 'Force per unit area.', category: 'Mechanics' },
  { id: 'f-strain', title: 'Strain', latex: '\\epsilon = \\frac{\\Delta L}{L}', description: 'Deformation per unit length.', category: 'Mechanics' },
];

export const GET102_FORMULAS: Formula[] = [
  { id: 'f-ohms-law', title: "Ohm's Law", latex: 'V = IR', description: 'Relationship between voltage, current, and resistance.', category: 'Electrical' },
];

export const ZOO101_FORMULAS: Formula[] = [
  { id: 'f-taxonomy', title: 'Taxonomic Hierarchy', latex: 'K \rightarrow P \rightarrow C \rightarrow O \rightarrow F \rightarrow G \rightarrow S', description: 'Kingdom, Phylum, Class, Order, Family, Genus, Species.', category: 'Taxonomy' },
];

export const ZOO102_FORMULAS: Formula[] = [
  { id: 'f-metabolism', title: 'Basal Metabolic Rate', latex: 'BMR = 10w + 6.25h - 5a + s', description: 'Mifflin-St Jeor Equation for BMR.', category: 'Physiology' },
];

export const MAT103_SYLLABUS: Module[] = [
  {
    id: 'vectors',
    title: '1. VECTORS',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Representation of vectors',
        content: `
### 1.1 Representation of vectors
The magnitude and direction of a vector may be represented by the line $OP$ directed from the initial point $O$ to the terminal point $P$ and denoted by $\\vec{OP}$.
*   **Magnitude (Modulus)**: The length of the vector $\\vec{OP}$, denoted by $|\\vec{OP}| = OP$.
*   **Direction**: Indicated by an arrow head on the line.
*   **Negative Vector**: A vector having the same magnitude as $\\vec{A}$ but opposite direction, denoted by $-\\vec{A}$.
*   **Equality**: Two vectors $\\vec{A}$ and $\\vec{B}$ are equal if they have the same magnitude and direction.
        `
      },
      {
        id: '1.2',
        title: '1.2 Kinds of vectors',
        content: `
### 1.2 Kinds of vectors
*   **Unit vector**: A vector having a unit magnitude i.e $|\\vec{a}| = 1$. If $a$ is the magnitude of $\\vec{a}$, then $\\vec{a}$ can be expressed as $\\vec{a} = a\\hat{a}$, where $\\hat{a}$ is the unit vector.
*   **Collinear vectors**: Two vectors $\\vec{a}$ and $\\vec{b}$ are said to be collinear if there exists a scalar $\\lambda$ such that $\\vec{a} = \\lambda\\vec{b}$.
*   **Coplanar vectors**: Three vectors $\\vec{a}$, $\\vec{b}$, and $\\vec{c}$ are said to be coplanar if their scalar triple product is zero, i.e., $\\vec{a} \\cdot (\\vec{b} \\times \\vec{c}) = 0$.
        `
      },
      {
        id: '1.3',
        title: '1.3 Addition and subtraction of vectors',
        content: `
### 1.3 Addition and subtraction of vectors
*   **Triangular law of addition**: Suppose two vectors $\\vec{a}$ and $\\vec{b}$ act at a point $O$. The sum is obtained by placing the initial point of $\\vec{b}$ on the terminal point of $\\vec{a}$. The vector from the initial point of $\\vec{a}$ to the terminal point of $\\vec{b}$ is the sum $\\vec{OB} = \\vec{C}$ (Resultant).
    $\\vec{a} + \\vec{b} = \\vec{OA} + \\vec{AB} = \\vec{OB}$
*   **Subtraction**: $\\vec{a} - \\vec{b} = \\vec{a} + (-\\vec{b})$.

#### Example 1
If $\\vec{X} = 3\\hat{i}+2\\hat{j}-\\hat{k}$ and $\\vec{Y} = 4\\hat{i}+3\\hat{j}+2\\hat{k}$, then:
*   $\\vec{X} + \\vec{Y} = (3+4)\\hat{i} + (2+3)\\hat{j} + (-1+2)\\hat{k} = 7\\hat{i} + 5\\hat{j} + \\hat{k}$
*   $\\vec{X} - \\vec{Y} = (3-4)\\hat{i} + (2-3)\\hat{j} + (-1-2)\\hat{k} = -\\hat{i} - \\hat{j} - 3\\hat{k}$
        `
      },
      {
        id: '1.4',
        title: '1.4 Multiplication of a vector by a scalar',
        content: `
### 1.4 Multiplication of a vector by a scalar
The product of a scalar $\\lambda$ and a vector $\\vec{a}$ is written as $\\vec{b} = \\lambda\\vec{a}$.
*   It has the same direction as $\\vec{a}$ if $\\lambda > 0$.

#### Example
If $\\vec{X} = 3\\hat{i} + 2\\hat{j} - \\hat{k}$, find $\\lambda\\vec{X}$ when $\\lambda = 3$.
$\\lambda\\vec{X} = 3(3\\hat{i} + 2\\hat{j} - \\hat{k}) = 9\\hat{i} + 6\\hat{j} - 3\\hat{k}$
        `
      },
      {
        id: '1.5',
        title: '1.5 Components of a vector',
        content: `
### 1.5 Components of a vector in three mutually perpendicular directions
Let $\\vec{OP}$ represent a vector $\\vec{r}$. It can be expressed in terms of unit vectors $\\hat{i}, \\hat{j}, \\hat{k}$ along the axes $OX, OY, OZ$:
$\\vec{r} = x\\hat{i} + y\\hat{j} + z\\hat{k}$

#### Note 1: Modulus (Magnitude)
$|\\vec{r}| = \\sqrt{x^2 + y^2 + z^2}$

#### Note 2: Direction cosines
If $OP$ makes angles $\\alpha, \\beta, \\gamma$ with $OX, OY, OZ$:
*   $\\cos \\alpha = \\frac{x}{\\sqrt{x^2 + y^2 + z^2}}$
*   $\\cos \\beta = \\frac{y}{\\sqrt{x^2 + y^2 + z^2}}$
*   $\\cos \\gamma = \\frac{z}{\\sqrt{x^2 + y^2 + z^2}}$
*   Identity: $\\cos^2 \\alpha + \\cos^2 \\beta + \\cos^2 \\gamma = 1$

#### Note 3: Distance between two points
For points $A(x_1, y_1, z_1)$ and $B(x_2, y_2, z_2)$:
$AB = |\\vec{AB}| = \\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2 + (z_2-z_1)^2}$

#### Example 1
If $\\vec{a} = 2\\hat{i} + 2\\hat{j} - \\hat{k}$ and $\\vec{b} = 3\\hat{i} + 4\\hat{k}$, find:
(i) Distance between $\\vec{a}$ and $\\vec{b}$: $\\sqrt{(3-2)^2 + (0-2)^2 + (4-(-1))^2} = \\sqrt{1+4+25} = \\sqrt{30}$
(ii) Magnitude of $\\vec{a}$: $\\sqrt{2^2+2^2+(-1)^2} = 3$. Magnitude of $\\vec{b}$: $\\sqrt{3^2+0^2+4^2} = 5$.
(iii) Direction cosines of $\\vec{a}$: $\\frac{2}{3}, \\frac{2}{3}, -\\frac{1}{3}$.

#### Example 2
If $\\vec{A} = 2\\hat{i}+3\\hat{j}-4\\hat{k}$, $\\vec{B} = 5\\hat{i}-2\\hat{j}+4\\hat{k}$, $\\vec{C} = 3\\hat{i}-5\\hat{j}+6\\hat{k}$.
Find magnitude and direction cosines of $\\vec{A} + 2(\\vec{B} + \\vec{C})$.
*   $\\vec{B} + \\vec{C} = 8\\hat{i} - 7\\hat{j} + 10\\hat{k}$
*   $\\vec{A} + 2(\\vec{B} + \\vec{C}) = 2\\hat{i}+3\\hat{j}-4\\hat{k} + 2(8\\hat{i} - 7\\hat{j} + 10\\hat{k}) = 18\\hat{i} - 11\\hat{j} + 16\\hat{k}$
*   Magnitude: $\\sqrt{18^2 + (-11)^2 + 16^2} = \\sqrt{701}$
        `
      },
      {
        id: '1.6',
        title: '1.6 Linear combination of vectors',
        content: `
### 1.6 Linear combination of vectors
A vector $V$ is a linear combination of vectors $V_1, V_2, \\dots, V_n$ if there exist scalars $\\alpha_i$ such that:
$V = \\alpha_1V_1 + \\alpha_2V_2 + \\dots + \\alpha_nV_n$

*   **Linearly Dependent**: The set of vectors is linearly dependent if there exist scalars $\\alpha_i$ (not all zero) such that $\\alpha_1V_1 + \\dots + \\alpha_nV_n = 0$.
*   **Linearly Independent**: If the only solution to $\\alpha_1V_1 + \\dots + \\alpha_nV_n = 0$ is $\\alpha_1 = \\dots = \\alpha_n = 0$.

#### Example 1
Show that $\\vec{r_1} = \\hat{j} - 2\\hat{k}$, $\\vec{r_2} = \\hat{i} - \\hat{j} + \\hat{k}$, $\\vec{r_3} = \\hat{i} + 2\\hat{j} + \\hat{k}$ are linearly independent.
Solution involves setting $\\alpha_1\\vec{r_1} + \\alpha_2\\vec{r_2} + \\alpha_3\\vec{r_3} = 0$ and solving for $\\alpha$'s.
Result: $\\alpha_1 = \\alpha_2 = \\alpha_3 = 0$.

#### Example 2
Show that $V_1 = 2a - 3b + c$, $V_2 = 3a - 5b + 2c$, $V_3 = 4a - 5b + c$ are linearly dependent.
Solution finds non-zero scalars $K_1=5, K_2=-2, K_3=-1$ such that $K_1V_1 + K_2V_2 + K_3V_3 = 0$.
        `
      },
      {
        id: '1.7',
        title: '1.7 Scalar (or dot) product of two vectors',
        content: `
### 1.7 Scalar (or dot) product of two vectors
The scalar product of $\\vec{a}$ and $\\vec{b}$ is defined as:
$\\vec{a} \\cdot \\vec{b} = |\\vec{a}||\\vec{b}| \\cos \\theta$

*   **Component Form**: If $\\vec{x} = x_1\\hat{i} + x_2\\hat{j} + x_3\\hat{k}$ and $\\vec{y} = y_1\\hat{i} + y_2\\hat{j} + y_3\\hat{k}$, then:
    $\\vec{x} \\cdot \\vec{y} = x_1y_1 + x_2y_2 + x_3y_3$
*   **Angle between vectors**: $\\theta = \\cos^{-1} \\left( \\frac{\\vec{a} \\cdot \\vec{b}}{|\\vec{a}||\\vec{b}|} \\right)$
*   **Perpendicularity**: Two vectors are perpendicular if $\\vec{a} \\cdot \\vec{b} = 0$.

#### Example 1
Let $\\vec{X} = 2\\hat{i} + 3\\hat{j}$ and $\\vec{Y} = 4\\hat{i} - 5\\hat{j}$.
$\\vec{X} \\cdot \\vec{Y} = (2)(4) + (3)(-5) = 8 - 15 = -7$.

#### Example 2
Let $\\vec{a} = \\hat{i} + 2\\hat{j} + 3\\hat{k}$, $\\vec{b} = 2\\hat{i} - 3\\hat{j} + 4\\hat{k}$.
$\\vec{a} \\cdot \\vec{b} = 2 - 6 + 12 = 8$.

#### Example 3
Given $\\vec{a} = \\hat{i} + \\hat{j}$, $\\vec{b} = 2\\hat{i} + 3\\hat{j}$. Find angle between them.
$|\\vec{a}| = \\sqrt{2}$, $|\\vec{b}| = \\sqrt{13}$, $\\vec{a} \\cdot \\vec{b} = 5$.
$\\theta = \\cos^{-1} \\left( \\frac{5}{\\sqrt{26}} \\right)$.

#### Example 4
Find $\\lambda$ if $3\\lambda\\hat{i} + 8\\hat{j}$ and $4\\hat{i} - 3\\hat{j}$ are perpendicular.
Dot product $= 12\\lambda - 24 = 0 \\Rightarrow \\lambda = 2$.
        `
      },
      {
        id: '1.8',
        title: '1.8 Vector product (or cross product)',
        content: `
### 1.8 Vector product (or cross product)
The vector product is defined as:
$\\vec{a} \\times \\vec{b} = |\\vec{a}||\\vec{b}| \\sin \\theta \\hat{n}$
where $\\hat{n}$ is a unit vector perpendicular to both $\\vec{a}$ and $\\vec{b}$.

#### 1.8.1 Vector product in terms of unit vectors
$\\vec{a} \\times \\vec{b} = \\begin{vmatrix} \\hat{i} & \\hat{j} & \\hat{k} \\\\ a_1 & a_2 & a_3 \\\\ b_1 & b_2 & b_3 \\end{vmatrix}$

#### Example 1
Find $\\vec{x} \\times \\vec{y}$ where $\\vec{x} = 2\\hat{i} + \\hat{j} + \\hat{k}$ and $\\vec{y} = 4\\hat{i} + 2\\hat{j} - 3\\hat{k}$.
Result: $-5\\hat{i} + 10\\hat{j}$.

#### 1.8.2 Area of triangle and parallelogram
*   **Area of triangle**: $A = \\frac{1}{2} |\\vec{a} \\times \\vec{b}|$ (where $\\vec{a}, \\vec{b}$ are adjacent sides).
*   **Area of parallelogram**: $A = |\\vec{a} \\times \\vec{b}|$.

#### Example
If $\\vec{a} = 2\\hat{i} + 3\\hat{j} - 4\\hat{k}$ and $\\vec{b} = 3\\hat{i} - 2\\hat{j} + 6\\hat{k}$.
$\\vec{a} \\times \\vec{b} = 10\\hat{i} - 24\\hat{j} - 13\\hat{k}$.
Area of triangle = $\\frac{1}{2}\\sqrt{10^2 + (-24)^2 + (-13)^2} = \\frac{1}{2}\\sqrt{845}$.
        `
      },
      {
        id: '1.9',
        title: '1.9 Differentiation of vectors',
        content: `
### 1.9 Differentiation of vectors
The differential coefficient of $\\vec{A}$ with respect to $t$ is:
$\\frac{d\\vec{A}}{dt} = \\lim_{\\Delta t \\to 0} \\frac{\\vec{A}(t + \\Delta t) - \\vec{A}(t)}{\\Delta t}$

If $\\vec{A} = x(t)\\hat{i} + y(t)\\hat{j} + z(t)\\hat{k}$, then:
$\\frac{d\\vec{A}}{dt} = \\frac{dx}{dt}\\hat{i} + \\frac{dy}{dt}\\hat{j} + \\frac{dz}{dt}\\hat{k}$

#### Example 1
Let $\\vec{P} = 4t^3\\hat{i} + \\cos 2t \\hat{j} + e^{2t^2}\\hat{k}$.
$\\frac{d\\vec{P}}{dt} = 12t^2\\hat{i} - 2\\sin 2t \\hat{j} + 4te^{2t^2}\\hat{k}$.

#### Example 2
Particle moves along curve $x = e^{-t}, y = 2\\cos 3t, z = 3\\sin 3t$.
Velocity $V = -e^{-t}\\hat{i} - 6\\sin 3t \\hat{j} + 9\\cos 3t \\hat{k}$.
Acceleration $a = e^{-t}\\hat{i} - 18\\cos 3t \\hat{j} - 27\\sin 3t \\hat{k}$.
At $t=0$: $|V| = \\sqrt{82}$, $|a| = \\sqrt{325}$.

#### Example 3
Given $\\vec{X} = 3u\\hat{i} - (7+u^2)\\hat{j} + u^3\\hat{k}$.
$\\left| \\frac{d\\vec{X}}{du} \\right|$ at $u=2$ is $\\sqrt{3^2 + (-4)^2 + 12^2} = 13$.
        `
      },
      {
        id: '1.10',
        title: '1.10 Integration of vectors',
        content: `
### 1.10 Integration of vectors
Integration is the reverse of differentiation.
*   **Indefinite Integral**: $\\int \\vec{b}(t)dt = \\vec{a}(t) + \\vec{c}$, where $\\vec{c}$ is the constant of integration.
*   **Definite Integral**: $\\int_{k_1}^{k_2} \\vec{b}(t)dt = [\\vec{a}(t)]_{k_1}^{k_2} = \\vec{a}(k_2) - \\vec{a}(k_1)$.

#### Example 1
Let $\\vec{x} = 2t^2\\hat{i} + 2\\hat{j} - 4t^2\\hat{k}$ and $\\vec{y} = 3t\\hat{i} - e^{-2t}\\hat{j} - 4t\\hat{k}$.
$\\int (\\vec{x} \\cdot \\vec{y}) dt = \\frac{3}{2}t^4 + e^{-2t} + 4t^4 + c$.

#### Example 2
Given $\\vec{r}(t) = 2\\hat{i} - \\hat{j} + 2\\hat{k}$ when $t=2$ and $\\vec{r}(t) = 4\\hat{i} - 2\\hat{j} + 3\\hat{k}$ when $t=3$.
Show that $\\int_2^3 \\vec{r} \\cdot \\frac{d\\vec{r}}{dt} dt = 10$.
Solution uses $\\int \\vec{r} \\cdot d\\vec{r} = \\frac{r^2}{2}$. Result is $\\frac{1}{2}[(\\sqrt{29})^2 - (3)^2] = 10$.
        `
      }
    ]
  },
  {
    id: 'geometry',
    title: '2. COORDINATES GEOMETRY',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Straight line',
        content: `
### 2.1 Straight line
The position of a point in the $x-y$ plane is specified by its coordinates $(x, y)$.

#### 2.1.1 Distance between two points
Using Pythagoras theorem, the distance $d$ between two points $P(x_1, y_1)$ and $Q(x_2, y_2)$ is:
$d = \\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}$

#### Example
Find distance between $A(3, 6)$ and $(9, -2)$.
$r = \\sqrt{(9-3)^2 + (-2-6)^2} = \\sqrt{36 + 64} = 10$.

#### 2.1.2 Gradient of a line joining two points
The gradient (slope) $M$ of a line defined as the ratio of change in $y$ to change in $x$:
$M = \\frac{y_2 - y_1}{x_2 - x_1} = \\tan \\theta$

#### Example
Find gradient of line joining $(-3, -5)$ and $(4, -1)$.
$M = \\frac{-1 - (-5)}{4 - (-3)} = \\frac{4}{7}$.

#### 2.1.3 Mid-point of a line segment
The coordinates of the mid-point $M(x, y)$ of a line segment joining $P(x_1, y_1)$ and $Q(x_2, y_2)$:
$M = \\left( \\frac{x_1+x_2}{2}, \\frac{y_1+y_2}{2} \\right)$

#### 2.1.4 Division of a line in a given ratio
If a point divides a line segment in the ratio $p:q$:
$x = \\frac{px_2 + qx_1}{p+q}, \\quad y = \\frac{py_2 + qy_1}{p+q}$

#### Example
Point $Z$ divides line $XY$ in ratio $3:-2$, where $X(3, 2)$ and $Y(4, 1)$.
$x = \\frac{3(4) - 2(3)}{3-2} = 6$.
$y = \\frac{3(1) - 2(2)}{3-2} = -1$.
Coordinate of $Z$ is $(6, -1)$.

#### 2.1.5 Equation of straight line
*   **Point-Slope Form**: $y - y_1 = m(x - x_1)$
*   **Slope-Intercept Form**: $y = mx + c$

#### 2.1.6 Angle between two lines
If two lines have slopes $M_1$ and $M_2$, the angle $\\theta$ between them is:
$\\tan \\theta = \\left| \\frac{M_2 - M_1}{1 + M_1M_2} \\right|$
*   **Perpendicular**: $M_1M_2 = -1$
*   **Parallel**: $M_1 = M_2$

#### Example 1
Find equation of line joining $A(3, 6)$ and $(9, -2)$ and line through $C(1, 2)$ perpendicular to $AB$.
$M_{AB} = \\frac{-2-6}{9-3} = -\\frac{4}{3}$. Eq: $3y + 4x = 30$.
Perpendicular slope $M_2 = \\frac{3}{4}$. Eq through $C$: $4y - 3x = 5$.
Intersection: $(21/5, 22/5)$.

#### Example 2
Find equation of line through $(6, 5)$ perpendicular to $3x - 4y = 8$.
Slope of given line $= 3/4$. Perpendicular slope $= -4/3$.
Eq: $y - 5 = -\\frac{4}{3}(x - 6) \\Rightarrow 3y + 4x + 19 = 0$.

#### Example 3
Find equation of line parallel to $5x + 4y = 18$ with x-intercept 2.
Slope $= -5/4$. Point $(2, 0)$.
Eq: $y - 0 = -\\frac{5}{4}(x - 2) \\Rightarrow 4y + 5x = 10$.

#### Example 4
Find acute angle between $y - 5x + 2 = 0$ and $y - 3x + 1 = 0$.
$M_1 = 5, M_2 = 3$.
$\\tan \\theta = \\left| \\frac{3-5}{1+15} \\right| = \\frac{2}{16} = 0.125$. $\\theta = 7.125^\\circ$.
        `
      },
      {
        id: '2.2',
        title: '2.2 Circle',
        content: `
### 2.2 Circle
A circle is the locus of points equidistant from a fixed point (center).

*   **Standard Equation**: $(x - x_c)^2 + (y - y_c)^2 = r^2$, where $(x_c, y_c)$ is the center and $r$ is the radius.
*   **General Equation**: $x^2 + y^2 + 2gx + 2fy + c = 0$.
    *   Center: $(-g, -f)$
    *   Radius: $\\sqrt{g^2 + f^2 - c}$

#### Example 1
Find equation of circle with center $(2, 3)$ and radius 5.
$(x-2)^2 + (y-3)^2 = 25 \\Rightarrow x^2 + y^2 - 4x - 6y - 12 = 0$.

#### Example 2
Find center and radius of $3x^2 + 3y^2 + 4x - 5y + 2 = 0$.
Divide by 3: $x^2 + y^2 + \\frac{4}{3}x - \\frac{5}{3}y + \\frac{2}{3} = 0$.
Center: $(-2/3, 5/6)$. Radius: $\\frac{\\sqrt{17}}{6}$.

#### Example 3
Find circumcircle of triangle with vertices $P(2, 3), Q(5, 4), R(3, 7)$.
Solve simultaneous equations for $g, f, c$.
Result: $11x^2 + 11y^2 - 67x - 107y + 312 = 0$.

#### 2.2.1 Equation of a tangent touching the circle at $(x_1, y_1)$
For the circle $x^2 + y^2 + 2gx + 2fy + c = 0$, the tangent at $(x_1, y_1)$ is:
$xx_1 + yy_1 + g(x+x_1) + f(y+y_1) + c = 0$

#### Example 1
Tangent at $(-2, 3)$ to $x^2 + y^2 - 4x + 2y - 27 = 0$.
Using formula: $y = x + 5$.

#### Example 2
Length of tangent to $x^2 + y^2 - 2x - 4y - 4 = 0$ from $(8, 10)$.
$t = \\sqrt{p^2 - r^2} = \\sqrt{104}$.

#### 2.2.2 Equation of a circle with diameter endpoints
If $A(x_1, y_1)$ and $B(x_2, y_2)$ are endpoints of a diameter:
$(x - x_1)(x - x_2) + (y - y_1)(y - y_2) = 0$

#### Example
Circle with diameter endpoints $(3, -2)$ and $(-1, -3)$.
$(x-3)(x+1) + (y+2)(y+3) = 0 \\Rightarrow x^2 + y^2 - 2x + 5y + 3 = 0$.
        `
      },
      {
        id: '2.3',
        title: '2.3 Parabola',
        content: `
### 2.3 Parabola
A parabola is a locus of points equidistant from a given point (focus) and a given line (directrix).
*   **Eccentricity**: $e = 1$.
*   **Standard Equation**: $y^2 = 4ax$ (Vertex at origin, Focus at $(a, 0)$).
*   **Translated**: $(y - y_1)^2 = 4a(x - x_1)$.

#### Example 1
Find equation of parabola vertex origin, focus $F(4, 0)$.
$a = 4 \\Rightarrow y^2 = 16x$.

#### Example 2
Determine vertices, foci, directrices for:
1.  $y^2 - 6y - 2x + 19 = 0 \\Rightarrow (y-3)^2 = 2(x-5)$. Vertex $(5, 3)$, Focus $(11/2, 3)$.
2.  $x^2 + 4x + 4y + 16 = 0 \\Rightarrow (x+2)^2 = -4(y+3)$. Vertex $(-2, -3)$, Focus $(-2, -4)$.

#### 2.3.1 Equation of tangent and normal at $(x_1, y_1)$
For $y^2 = 4ax$:
*   **Tangent**: $yy_1 = 2a(x + x_1)$
*   **Normal**: $y - y_1 = -\\frac{y_1}{2a}(x - x_1)$

#### Example 3
Tangent and normal to $y^2 = 8x$ at $(2, 4)$.
Tangent: $y = x + 2$.
Normal: $y = -x + 6$.
        `
      },
      {
        id: '2.4',
        title: '2.4 Ellipse',
        content: `
### 2.4 Ellipse
An ellipse is the locus of a point moving such that the sum of its distances from two fixed points (foci) is constant.
*   **Standard Equation**: $\\frac{x^2}{a^2} + \\frac{y^2}{b^2} = 1$ (where $a > b$).
*   **Relation**: $b^2 = a^2(1 - e^2)$.
*   **Eccentricity**: $e < 1$.

#### Example
Find vertices and foci of:
(a) $9x^2 + 10y^2 = 90 \\Rightarrow \\frac{x^2}{10} + \\frac{y^2}{9} = 1$. Vertices $(\\pm\\sqrt{10}, 0)$. Foci $(\\pm 1, 0)$.
(b) $4y^2 + 5x^2 = 20$. Vertices $(0, \\pm\\sqrt{5})$. Foci $(0, \\pm 1)$.

#### 2.4.1 Change of origin
If the center is at $(x_1, y_1)$:
$\\frac{(x - x_1)^2}{a^2} + \\frac{(y - y_1)^2}{b^2} = 1$

#### Example
$4x^2 + 5y^2 - 24x - 20y + 36 = 0 \\Rightarrow \\frac{(x-3)^2}{5} + \\frac{(y-2)^2}{4} = 1$.
Center $(3, 2)$. Vertices $(3\\pm\\sqrt{5}, 2)$. Foci $(3\\pm 1, 2)$.

#### 2.4.2 Equation of tangent and normal
For $\\frac{x^2}{a^2} + \\frac{y^2}{b^2} = 1$ at $(x_1, y_1)$:
*   **Tangent**: $\\frac{xx_1}{a^2} + \\frac{yy_1}{b^2} = 1$

#### Example
Tangent and normal to $4x^2 + 25y^2 = 100$ at $(-3, 8/5)$.
Tangent: $10y - 3x - 25 = 0$.
Normal: $15y + 50x + 126 = 0$.
        `
      },
      {
        id: '2.5',
        title: '2.5 Hyperbola',
        content: `
### 2.5 Hyperbola
The locus of a point where the difference of distances from two foci is constant.
*   **Standard Equation**: $\\frac{x^2}{a^2} - \\frac{y^2}{b^2} = 1$.
*   **Relation**: $b^2 = c^2 - a^2$.
*   **Eccentricity**: $e > 1$.

#### Example
Find vertices and foci of $25x^2 - 4y^2 = 100 \\Rightarrow \\frac{x^2}{4} - \\frac{y^2}{25} = 1$.
Vertices $(\\pm 2, 0)$. Foci $(\\pm\\sqrt{29}, 0)$.

#### 2.5.1 Change of origin
If the center is at $(x_1, y_1)$:
$\\frac{(x - x_1)^2}{a^2} - \\frac{(y - y_1)^2}{b^2} = 1$

#### Example
$3x^2 - 8y^2 - 6x + 32y - 53 = 0 \\Rightarrow \\frac{(x-1)^2}{8} - \\frac{(y-2)^2}{3} = 1$.
$a = 2\\sqrt{2}, b = \\sqrt{3}, c = \\sqrt{11}$.
Foci $(1\\pm\\sqrt{11}, 2)$. Vertices $(1\\pm 2\\sqrt{2}, 2)$.
        `
      }
    ]
  },
  {
    id: 'motion',
    title: '3. MOTION',
    subTopics: [
      {
        id: '3.1',
        title: '3.1 Equation of motion',
        content: `
### 3.1 Equation of motion
*   **Displacement**: Distance covered in a specified direction ($m$).
*   **Velocity**: Rate of change of displacement ($m/s$).
*   **Acceleration**: Rate of change of velocity ($m/s^2$).

#### 3.1.1 Motion with constant acceleration
For a body moving with initial velocity $u$, final velocity $v$, acceleration $a$, in time $t$, covering distance $s$:
1.  $v = u + at$
2.  $s = ut + \\frac{1}{2}at^2$
3.  $v^2 = u^2 + 2as$
4.  $s = \\frac{1}{2}(u + v)t$

#### Example 1
Particle starts from rest ($u=0$), uniform acceleration $1.5m/s^2$.
Velocity after 10s: $v = 0 + 1.5(10) = 15m/s$.
Distance: $s = 0 + 0.5(1.5)(100) = 75m$.

#### Example 2
Speed increases from $8km/hr$ to $10km/hr$ in $82m$.
$v^2 = u^2 + 2as \\Rightarrow 10^2 = 8^2 + 2a(82) \\Rightarrow a = \\frac{9}{41} km/hr^2$.
Time: $t = 9\\frac{1}{9} hr$.

#### Example 3
Car starts from rest, accelerates to $60m/s$ in 10s. Brakes to rest in 4s.
(a) Acceleration $a = 60/10 = 6m/s^2$.
(b) Retardation $-a = 60/4 = 15m/s^2$.
(c) Distance = Area of triangle = $0.5 \\times 14 \\times 60 = 420m$.

#### Example 4
Car reaches $30m/s$ in 3s, constant speed for 4s, rest in 3s.
Total distance = Area of trapezium = $0.5(4 + 10) \\times 30 = 210m$.

#### 3.1.2 Acceleration due to gravity ($g$)
For free-falling bodies near the earth's surface, $a = g \\approx 9.8 m/s^2$.
*   For upward motion, $a = -g$.
*   For downward motion, $a = g$.

#### Example 1
Body projected vertically upwards with $50m/s$.
Max height ($v=0$): $0 = 50^2 - 2(9.8)s \\Rightarrow s = 127.6m$.
Time: $0 = 50 - 9.8t \\Rightarrow t = 5s$.

#### Example 2
Man on building 60m high projects body upwards with $20m/s$.
(i) Max height above ground: $H = 80.4m$.
(ii) Velocity hitting ground: $v = 39.7m/s$.
        `
      },
      {
        id: '3.2',
        title: '3.2 Force, Momentum and Impulse',
        content: `
### 3.2 Force, Momentum and Impulse
*   **Force**: From Newton's Second Law, $F = ma$. Measured in Newtons (N).
*   **Momentum**: The product of mass and velocity, $p = mv$.
    *   $F = \\frac{d(mv)}{dt} = m\\frac{dv}{dt} = ma$.

#### Example
Particle mass 4kg on smooth surface, acceleration $2m/s^2$.
Force $f = 4 \\times 2 = 8N$.

#### 3.2.1 Impulse
Impulse is the change in momentum produced by a force acting over time $t$.
*   $I = F \\times t = m(v - u)$
*   Impulse = Change in momentum.

#### Example 1
Velocity of 2kg body changes from $4m/s$ to $10m/s$ in 3s.
$10 = 4 + 3a \\Rightarrow a = 2m/s^2$.
Force $F = 2(2) = 4N$.
Impulse = $4 \\times 3 = 12Ns$.

#### Example 2
Force 6N acts for 2s on 3kg mass moving at $10m/s$.
$6(2) = 3(v - 10) \\Rightarrow v = 14m/s$.
Change in momentum = $12kgm/s$.
        `
      },
      {
        id: '3.3',
        title: '3.3 Conservation of momentum principle',
        content: `
### 3.3 Conservation of momentum principle
In any collision between two bodies, the total momentum in any direction is unchanged provided no external force acts in that direction.
For two bodies of masses $m_1, m_2$ with initial velocities $u_1, u_2$ and final velocities $v_1, v_2$:
$m_1u_1 + m_2u_2 = m_1v_1 + m_2v_2$

#### Example 1
Trucks 80kg ($4m/s$) and 50kg ($2m/s$) collide and move together.
$(80 \\times 4) + (50 \\times 2) = (80 + 50)v \\Rightarrow v = 3.23m/s$.

#### Example 2
Balls 0.8kg ($2m/s$) and 0.5kg ($3.4m/s$) collide. First ball rebounds at $1.5m/s$.
$(0.8 \\times 2) + (0.5 \\times -3.4) = (0.8 \\times -1.5) + (0.5 \\times v_2)$.
$v_2 = 2.2m/s$.
Impulse = $2.8kgm/s$.
        `
      },
      {
        id: '3.4',
        title: '3.4 Motion along an inclined plane',
        content: `
### 3.4 Motion along an inclined plane
Consider a body of mass $m$ on a smooth plane inclined at an angle $\\theta$ to the horizontal.
*   **Forces acting**:
    1.  Weight $mg$ acting vertically downwards.
    2.  Normal reaction $R$ perpendicular to the plane.
*   **Components of weight**:
    *   Perpendicular to plane: $mg \\cos \\theta$
    *   Parallel to plane (downwards): $mg \\sin \\theta$
*   **Equation of motion**:
    If a force $f$ acts up the plane:
    $f - mg \\sin \\theta = ma$

#### Example 1
Object weight 20kg on smooth plane inclined at $30^\\circ$.
(a) Acceleration down plane ($f=0$): $mg \\sin 30^\\circ = ma \\Rightarrow a = 5m/s^2$.
(b) Velocity after 4s:
(i) From rest: $v = 0 + 5(4) = 20m/s$.
(ii) Initial $10m/s$: $v = 5 + 5(4) = 25m/s$.
        `
      }
    ]
  },
];

export const MAT101_SYLLABUS: Module[] = [
  {
    id: 'algebra',
    title: '1. ALGEBRA',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Sets and Operations',
        content: String.raw`
### 1.1 Sets and Operations

A **set** is a well-defined collection of distinct objects, considered as an object in its own right. Sets are conventionally denoted by capital letters (e.g., $A, B, C$) and their elements by lowercase letters.

#### Core Definitions
*   **Universal Set ($U$ or $\varepsilon$)**: The set containing all objects or elements and of which all other sets are subsets.
*   **Empty Set ($\emptyset$ or $\{\}$)**: A set containing no elements.
*   **Subset ($A \subseteq B$)**: $A$ is a subset of $B$ if every element of $A$ is also an element of $B$.

#### Set Operations
1.  **Union ($A \cup B$)**: The set of elements that are in $A$, in $B$, or in both.
    $$ A \cup B = \{x \mid x \in A \text{ or } x \in B\} $$
2.  **Intersection ($A \cap B$)**: The set of elements that are in both $A$ and $B$.
    $$ A \cap B = \{x \mid x \in A \text{ and } x \in B\} $$
3.  **Difference ($A \setminus B$ or $A - B$)**: The set of elements in $A$ that are not in $B$.
    $$ A \setminus B = \{x \mid x \in A \text{ and } x \notin B\} $$
4.  **Complement ($A'$ or $A^c$)**: The set of elements in the universal set that are not in $A$.
    $$ A' = \{x \in U \mid x \notin A\} $$

#### De Morgan's Laws
These laws relate the intersection and union of sets through complements:
1.  $(A \cup B)' = A' \cap B'$
2.  $(A \cap B)' = A' \cup B'$

---

#### Example 1: Basic Operations
Let the universal set $U = \{1, 2, 3, 4, 5, 6, 7, 8, 9, 10\}$.
Let $A = \{2, 4, 6, 8, 10\}$ and $B = \{1, 2, 3, 4, 5\}$.

**Find:**
a) $A \cup B$
b) $A \cap B$
c) $A'$
d) $A \setminus B$

**Solution:**
a) $A \cup B = \{1, 2, 3, 4, 5, 6, 8, 10\}$ (Combine all unique elements)
b) $A \cap B = \{2, 4\}$ (Elements common to both)
c) $A' = \{1, 3, 5, 7, 9\}$ (Elements in $U$ but not in $A$)
d) $A \setminus B = \{6, 8, 10\}$ (Elements in $A$ but removing any that are also in $B$)
        `
      },
      {
        id: '1.2',
        title: '1.2 Quadratic Equations',
        content: String.raw`
### 1.2 Quadratic Equations

A quadratic equation is a second-degree polynomial equation in a single variable $x$, with the standard form:
$$ ax^2 + bx + c = 0 $$
where $x$ represents an unknown, and $a, b,$ and $c$ are constants with $a \neq 0$.

#### Methods of Solution
1.  **Factorization**: Expressing the quadratic as a product of two linear binomials.
2.  **Completing the Square**: Manipulating the equation into the form $(x+p)^2 = q$.
3.  **Quadratic Formula**: Derived from completing the square, providing a direct solution:
    $$ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} $$

#### The Discriminant ($\Delta$)
The expression under the square root in the quadratic formula, $\Delta = b^2 - 4ac$, is called the discriminant. It determines the nature of the roots:
*   If $\Delta > 0$: Two distinct real roots.
*   If $\Delta = 0$: One repeated real root (a double root).
*   If $\Delta < 0$: Two complex conjugate roots (no real roots).

#### Sum and Product of Roots
If $\alpha$ and $\beta$ are the roots of $ax^2 + bx + c = 0$:
*   **Sum of roots**: $\alpha + \beta = -\frac{b}{a}$
*   **Product of roots**: $\alpha\beta = \frac{c}{a}$

---

#### Example 1: Using the Quadratic Formula
Solve the equation $2x^2 - 5x - 3 = 0$.

**Solution:**
Here, $a = 2$, $b = -5$, and $c = -3$.
First, calculate the discriminant:
$$ \Delta = (-5)^2 - 4(2)(-3) = 25 + 24 = 49 $$
Since $\Delta > 0$, there are two distinct real roots.
$$ x = \frac{-(-5) \pm \sqrt{49}}{2(2)} = \frac{5 \pm 7}{4} $$
$$ x_1 = \frac{5 + 7}{4} = \frac{12}{4} = 3 $$
$$ x_2 = \frac{5 - 7}{4} = \frac{-2}{4} = -\frac{1}{2} $$
The roots are $x = 3$ and $x = -1/2$.

#### Example 2: Forming an Equation from Roots
Find the quadratic equation whose roots are $2 + \sqrt{3}$ and $2 - \sqrt{3}$.

**Solution:**
Let $\alpha = 2 + \sqrt{3}$ and $\beta = 2 - \sqrt{3}$.
Sum of roots ($\alpha + \beta$) = $(2 + \sqrt{3}) + (2 - \sqrt{3}) = 4$.
Product of roots ($\alpha\beta$) = $(2 + \sqrt{3})(2 - \sqrt{3}) = 2^2 - (\sqrt{3})^2 = 4 - 3 = 1$.
The equation is $x^2 - (\text{Sum})x + (\text{Product}) = 0$.
$$ x^2 - 4x + 1 = 0 $$
        `
      },
      {
        id: '1.3',
        title: '1.3 Polynomials & Partial Fractions',
        content: String.raw`
### 1.3 Polynomials & Partial Fractions

A polynomial of degree $n$ in variable $x$ is an expression of the form:
$$ P(x) = a_n x^n + a_{n-1} x^{n-1} + \dots + a_1 x + a_0 $$
where $a_n \neq 0$ and $n$ is a non-negative integer.

#### Remainder and Factor Theorems
*   **Remainder Theorem**: If a polynomial $P(x)$ is divided by $(x - c)$, the remainder is $P(c)$.
*   **Factor Theorem**: A polynomial $P(x)$ has a factor $(x - c)$ if and only if $P(c) = 0$.

#### Partial Fractions
Rational functions of the form $\frac{P(x)}{Q(x)}$ (where degree of $P <$ degree of $Q$) can be decomposed into simpler fractions.

**Case 1: Distinct Linear Factors**
If $Q(x) = (ax+b)(cx+d)$, then:
$$ \frac{P(x)}{(ax+b)(cx+d)} = \frac{A}{ax+b} + \frac{B}{cx+d} $$

**Case 2: Repeated Linear Factors**
If $Q(x) = (ax+b)^2$, then:
$$ \frac{P(x)}{(ax+b)^2} = \frac{A}{ax+b} + \frac{B}{(ax+b)^2} $$

**Case 3: Irreducible Quadratic Factors**
If $Q(x) = (ax^2+bx+c)$, then:
$$ \frac{P(x)}{(ax^2+bx+c)(\dots)} = \frac{Ax+B}{ax^2+bx+c} + \dots $$

---

#### Example 1: Factor Theorem
Determine if $(x-2)$ is a factor of $P(x) = x^3 - 4x^2 + x + 6$.

**Solution:**
By the Factor Theorem, $(x-2)$ is a factor if $P(2) = 0$.
$$ P(2) = (2)^3 - 4(2)^2 + (2) + 6 $$
$$ P(2) = 8 - 16 + 2 + 6 = 0 $$
Since $P(2) = 0$, $(x-2)$ is indeed a factor.

#### Example 2: Partial Fraction Decomposition
Resolve $\frac{5x - 4}{(x-1)(x+2)}$ into partial fractions.

**Solution:**
Let $\frac{5x - 4}{(x-1)(x+2)} = \frac{A}{x-1} + \frac{B}{x+2}$.
Multiply through by the common denominator $(x-1)(x+2)$:
$$ 5x - 4 = A(x+2) + B(x-1) $$
To find $A$, let $x = 1$:
$$ 5(1) - 4 = A(1+2) \Rightarrow 1 = 3A \Rightarrow A = \frac{1}{3} $$
To find $B$, let $x = -2$:
$$ 5(-2) - 4 = B(-2-1) \Rightarrow -14 = -3B \Rightarrow B = \frac{14}{3} $$
Therefore:
$$ \frac{5x - 4}{(x-1)(x+2)} = \frac{1}{3(x-1)} + \frac{14}{3(x+2)} $$
        `
      }
    ]
  },
  {
    id: 'trigonometry',
    title: '2. TRIGONOMETRY',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Trigonometric Ratios & Identities',
        content: String.raw`
### 2.1 Trigonometric Ratios & Identities

Trigonometry relates the angles of a triangle to the lengths of its sides.

#### Basic Ratios (SOH CAH TOA)
For a right-angled triangle with angle $\theta$:
*   $\sin \theta = \frac{\text{Opposite}}{\text{Hypotenuse}}$
*   $\cos \theta = \frac{\text{Adjacent}}{\text{Hypotenuse}}$
*   $\tan \theta = \frac{\text{Opposite}}{\text{Adjacent}} = \frac{\sin \theta}{\cos \theta}$

#### Reciprocal Functions
*   $\csc \theta = \frac{1}{\sin \theta}$
*   $\sec \theta = \frac{1}{\cos \theta}$
*   $\cot \theta = \frac{1}{\tan \theta}$

#### Fundamental Pythagorean Identities
1.  $\sin^2 \theta + \cos^2 \theta = 1$
2.  $1 + \tan^2 \theta = \sec^2 \theta$
3.  $1 + \cot^2 \theta = \csc^2 \theta$

#### Compound Angle Formulas
*   $\sin(A \pm B) = \sin A \cos B \pm \cos A \sin B$
*   $\cos(A \pm B) = \cos A \cos B \mp \sin A \sin B$
*   $\tan(A \pm B) = \frac{\tan A \pm \tan B}{1 \mp \tan A \tan B}$

---

#### Example 1: Using Identities
Prove that $\frac{\sin \theta}{1 + \cos \theta} + \frac{1 + \cos \theta}{\sin \theta} = 2\csc \theta$.

**Solution:**
Find a common denominator for the left-hand side (LHS):
$$ \text{LHS} = \frac{\sin^2 \theta + (1 + \cos \theta)^2}{\sin \theta (1 + \cos \theta)} $$
Expand the numerator:
$$ \text{LHS} = \frac{\sin^2 \theta + 1 + 2\cos \theta + \cos^2 \theta}{\sin \theta (1 + \cos \theta)} $$
Group $\sin^2 \theta + \cos^2 \theta$ and replace with $1$:
$$ \text{LHS} = \frac{1 + 1 + 2\cos \theta}{\sin \theta (1 + \cos \theta)} = \frac{2 + 2\cos \theta}{\sin \theta (1 + \cos \theta)} $$
Factor out $2$:
$$ \text{LHS} = \frac{2(1 + \cos \theta)}{\sin \theta (1 + \cos \theta)} $$
Cancel the common term $(1 + \cos \theta)$:
$$ \text{LHS} = \frac{2}{\sin \theta} = 2\csc \theta = \text{RHS} $$
        `
      },
      {
        id: '2.2',
        title: '2.2 Trigonometric Equations',
        content: String.raw`
### 2.2 Trigonometric Equations

Solving trigonometric equations involves finding all angles that satisfy a given condition. Because trigonometric functions are periodic, there are often infinite solutions unless a specific domain (interval) is given.

#### The CAST Rule (ASTC)
To find solutions in different quadrants:
*   **Q1 (All)**: All ratios are positive. Angle = $\alpha$ (Principal angle)
*   **Q2 (Sine)**: Only Sine is positive. Angle = $180^\circ - \alpha$ (or $\pi - \alpha$)
*   **Q3 (Tangent)**: Only Tangent is positive. Angle = $180^\circ + \alpha$ (or $\pi + \alpha$)
*   **Q4 (Cosine)**: Only Cosine is positive. Angle = $360^\circ - \alpha$ (or $2\pi - \alpha$)

#### General Solutions
If $\alpha$ is the principal value:
*   For $\sin \theta = k$: $\theta = n\pi + (-1)^n \alpha$
*   For $\cos \theta = k$: $\theta = 2n\pi \pm \alpha$
*   For $\tan \theta = k$: $\theta = n\pi + \alpha$
where $n \in \mathbb{Z}$ (any integer).

---

#### Example 1: Solving in a Given Interval
Solve $2\cos^2 x - \cos x - 1 = 0$ for $0^\circ \le x \le 360^\circ$.

**Solution:**
This is a quadratic equation in terms of $\cos x$. Let $y = \cos x$.
$$ 2y^2 - y - 1 = 0 $$
Factorizing:
$$ (2y + 1)(y - 1) = 0 $$
So, $y = -1/2$ or $y = 1$.

**Case 1:** $\cos x = 1$
In the interval $[0^\circ, 360^\circ]$, $\cos x = 1$ at $x = 0^\circ$ and $x = 360^\circ$.

**Case 2:** $\cos x = -1/2$
The principal angle for $\cos \alpha = 1/2$ is $\alpha = 60^\circ$.
Since cosine is negative in Q2 and Q3:
*   Q2 solution: $x = 180^\circ - 60^\circ = 120^\circ$
*   Q3 solution: $x = 180^\circ + 60^\circ = 240^\circ$

**Final Answer:**
$x \in \{0^\circ, 120^\circ, 240^\circ, 360^\circ\}$
        `
      }
    ]
  }
];


export const STA112_SYLLABUS: Module[] = [
  {
    id: 'intro-prob',
    title: '1. INTRODUCTION TO PROBABILITY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Basic Concepts',
        content: String.raw`
### 1.1 Basic Concepts
*   **Experiment**: A process that leads to one of several possible outcomes.
*   **Sample Space (S)**: The set of all possible outcomes of an experiment.
*   **Event (E)**: A subset of the sample space.
*   **Probability of an Event**: $P(E) = \frac{n(E)}{n(S)}$.

#### Example 1
Tossing a fair coin.
**Solution**:
$S = \{H, T\}$, $n(S) = 2$.
Event $E = \{H\}$, $n(E) = 1$.
$P(E) = 1/2$.
        `
      },
      {
        id: '1.2',
        title: '1.2 Probability Laws',
        content: String.raw`
### 1.2 Probability Laws
*   **Addition Law**: $P(A \cup B) = P(A) + P(B) - P(A \cap B)$.
*   **Complement Rule**: $P(A') = 1 - P(A)$.

#### Example 1
If $P(A) = 0.6, P(B) = 0.5$ and $P(A \cap B) = 0.3$. Find $P(A \cup B)$.
**Solution**:
$P(A \cup B) = 0.6 + 0.5 - 0.3 = 0.8$.
        `
      }
    ]
  },
  {
    id: 'cond-prob',
    title: '2. CONDITIONAL PROBABILITY',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Conditional Probability & Independence',
        content: String.raw`
### 2.1 Conditional Probability & Independence
*   **Conditional Probability**: $P(A|B) = \frac{P(A \cap B)}{P(B)}$.
*   **Independent Events**: $P(A \cap B) = P(A)P(B)$.

#### Example 1
If $P(A) = 0.4, P(B) = 0.5$ and $A, B$ are independent. Find $P(A \cap B)$.
**Solution**:
$P(A \cap B) = 0.4 \times 0.5 = 0.2$.
        `
      },
      {
        id: '2.2',
        title: '2.2 Bayes\' Theorem',
        content: String.raw`
### 2.2 Bayes' Theorem
$P(A|B) = \frac{P(B|A)P(A)}{P(B)}$

#### Example 1
Standard medical test example.
        `
      }
    ]
  },
  {
    id: 'random-vars',
    title: '3. RANDOM VARIABLES',
    subTopics: [
      {
        id: '3.1',
        title: '3.1 Discrete Random Variables',
        content: String.raw`
### 3.1 Discrete Random Variables
*   **Expected Value**: $E[X] = \sum x P(x)$.
*   **Variance**: $Var(X) = E[X^2] - (E[X])^2$.

#### Example 1
Find $E[X]$ for a fair die.
**Solution**:
$E[X] = (1+2+3+4+5+6)/6 = 3.5$.
        `
      }
    ]
  }
];


export const BIO101_SYLLABUS: Module[] = [
  {
    id: 'intro-to-biology',
    title: '1. INTRODUCTION TO BIOLOGY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Biology as a Science',
        content: `
### 1.1 Biology as a Science
*   **Scientific Method**: A systematic approach to understanding the natural world, involving observation, hypothesis formulation, experimentation, data analysis, and conclusion.
*   **Hypothesis Testing**: Hypotheses must be testable and falsifiable. Experimental design requires controlled variables and a clear independent/dependent variable structure.
*   **Historical Context**: The first forms of life on Earth are thought to have been microorganisms that existed for billions of years before plants and animals appeared. Humans have inhabited this planet for only the last 2.5 million years.
        `
      },
      {
        id: '1.2',
        title: '1.2 Origin of Life',
        content: `
### 1.2 Origin of Life
*   **Early Earth Conditions**: Reducing atmosphere (lacking oxygen), high volcanic activity, intense UV radiation, and electrical storms.
*   **Oparin-Haldane Hypothesis**: Life arose from non-living matter through a series of chemical reactions in the "primordial soup," where simple organic compounds formed.
*   **Miller-Urey Experiment (1953)**: Demonstrated that organic molecules (like amino acids) could be synthesized from inorganic precursors (methane, ammonia, hydrogen, water) under simulated early Earth conditions.
*   **RNA World Hypothesis**: Suggests that RNA was the first genetic material, capable of both storing information and catalyzing chemical reactions (ribozymes), preceding DNA and proteins.
*   **Protocells**: Simple, membrane-bound structures (liposomes) that may have been the precursors to the first true cells, allowing for compartmentalization of metabolic reactions.
        `
      },
      {
        id: '1.3',
        title: '1.3 Chemistry of Living Things',
        relatedTo: ['2.3', '2.4'],
        content: `
### 1.3 Chemistry of Living Things
*   **Water**: Essential for life due to polarity, hydrogen bonding, cohesion (water-water attraction), adhesion (water-surface attraction), high specific heat (temperature regulation), and solvent properties (dissolving polar/ionic substances).
*   **pH and Buffers**: pH measures acidity/basicity ($pH = -log[H^+]$). Buffers (e.g., bicarbonate buffer system in blood) resist changes in pH, crucial for maintaining homeostasis in biological systems.
*   **Biological Macromolecules**:
    *   **Carbohydrates**: Monosaccharides (e.g., glucose, fructose), disaccharides (e.g., sucrose, lactose), polysaccharides (e.g., starch, glycogen, cellulose). Functions: energy storage, structural support.
    *   **Lipids**: Hydrophobic molecules (fats, phospholipids, steroids). Functions: long-term energy storage, membrane structure (phospholipid bilayer), signaling (steroid hormones).
    *   **Proteins**: Polymers of amino acids linked by peptide bonds. Functions: enzymes (catalysis), structure (collagen), transport (hemoglobin), signaling (insulin). Levels of structure: primary (sequence), secondary (alpha-helix/beta-sheet), tertiary (3D folding), quaternary (multiple subunits).
    *   **Nucleic Acids**: DNA and RNA. Polymers of nucleotides (sugar, phosphate, nitrogenous base). Functions: DNA stores genetic information; RNA transfers information for protein synthesis.
        `
      }
    ]
  },
  {
    id: 'the-cell',
    title: '2. THE CELL',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Cell Structure and Functions of Cellular Organelles',
        relatedTo: ['2.2', '2.3', '2.4'],
        content: `
### 2.1 Cell Structure and Functions of Cellular Organelles
*   **Cell Theory**: The cell is the smallest fundamental unit of structure and function in living organisms. All living things are made of cells.
*   **Cell Types**:
    *   **Prokaryotic**: Single-celled organisms (Bacteria, Archaea) that lack organelles surrounded by a membrane and do not have nuclei surrounded by nuclear membranes. DNA is in a nucleoid region.
    *   **Eukaryotic**: Cells (Protists, Fungi, Plants, Animals) that have membrane-bound organelles and true nuclei.
*   **Organelles**:
    *   **Nucleus**: Contains genetic material (DNA), site of transcription.
    *   **Mitochondria**: Site of cellular respiration (ATP production).
    *   **Ribosomes**: Site of protein synthesis (70S in prokaryotes, 80S in eukaryotes).
    *   **Endoplasmic Reticulum (ER)**: Rough ER (protein synthesis/folding), Smooth ER (lipid synthesis, detoxification).
    *   **Golgi Apparatus**: Modifies, sorts, and packages proteins.
    *   **Lysosomes**: Contain digestive enzymes (animal cells).
    *   **Chloroplasts**: Site of photosynthesis (plant cells).
    *   **Vacuoles**: Storage, structural support (large central vacuole in plants).
        `
      },
      {
        id: '2.2',
        title: '2.2 Membrane Structure and Transport',
        content: `
### 2.2 Membrane Structure and Transport
*   **Fluid Mosaic Model**: Cell membrane is a phospholipid bilayer with embedded proteins, cholesterol, and carbohydrates.
*   **Passive Transport**: Movement down a concentration gradient (no energy required).
    *   **Diffusion**: Movement of small, nonpolar molecules.
    *   **Osmosis**: Diffusion of water across a selectively permeable membrane.
    *   **Facilitated Diffusion**: Movement of polar/charged molecules via transport proteins.
*   **Active Transport**: Movement against a concentration gradient (requires ATP).
    *   **Primary Active Transport**: Direct use of ATP (e.g., Sodium-Potassium pump).
    *   **Secondary Active Transport**: Uses electrochemical gradient established by primary transport (e.g., co-transport).
*   **Bulk Transport**: Endocytosis (into cell) and Exocytosis (out of cell).
        `
      },
      {
        id: '2.3',
        title: '2.3 Cellular Respiration (Catabolic Pathways)',
        relatedTo: ['1.3', '2.1', '2.4'],
        content: `
### 2.3 Cellular Respiration (Catabolic Pathways)
*   **Overview**: $C_6H_{12}O_6 + 6O_2 \rightarrow 6CO_2 + 6H_2O + ATP + Heat$.
*   **Glycolysis**: Occurs in the cytoplasm. Glucose (6C) broken down into 2 Pyruvate (3C). Produces 2 ATP (net) and 2 NADH.
*   **Pyruvate Oxidation**: Pyruvate enters mitochondria, converted to Acetyl-CoA. Produces NADH and $CO_2$.
*   **Krebs Cycle (Citric Acid Cycle)**: Occurs in the mitochondrial matrix. Acetyl-CoA oxidized to $CO_2$. Produces ATP (or GTP), NADH, and $FADH_2$.
*   **Electron Transport Chain (ETC) & Oxidative Phosphorylation**: Occurs in the inner mitochondrial membrane. NADH and $FADH_2$ donate electrons to ETC. Proton gradient created, driving ATP synthase to produce ATP (Chemiosmosis). Oxygen is the final electron acceptor, forming water.
*   **Fermentation**: Anaerobic pathway (no oxygen). Lactic acid fermentation or alcoholic fermentation. Regenerates $NAD^+$ to allow glycolysis to continue.
        `
      },
      {
        id: '2.4',
        title: '2.4 Photosynthesis (Anabolic Pathways)',
        content: `
### 2.4 Photosynthesis (Anabolic Pathways)
*   **Overview**: $6CO_2 + 6H_2O + Light \rightarrow C_6H_{12}O_6 + 6O_2$. Occurs in chloroplasts.
*   **Light-Dependent Reactions**: Occurs in thylakoid membranes. Light energy absorbed by chlorophyll, splitting water (photolysis) to release $O_2$, electrons, and protons. ATP and NADPH produced.
*   **Calvin Cycle (Light-Independent Reactions)**: Occurs in the stroma. Uses ATP and NADPH from light reactions to fix $CO_2$ into G3P (a sugar precursor). Consists of carbon fixation (catalyzed by Rubisco), reduction, and regeneration of RuBP.
        `
      },
      {
        id: '2.5',
        title: '2.5 Cell Division (Mitosis and Meiosis)',
        content: `
### 2.5 Cell Division (Mitosis and Meiosis)
*   **Cell Cycle**: Interphase (G1, S, G2) and M phase (Mitosis/Meiosis + Cytokinesis).
*   **Mitosis**: Produces two genetically identical daughter cells. Used for growth, repair, asexual reproduction.
    *   **Prophase**: Chromosomes condense, nuclear envelope breaks down, spindle forms.
    *   **Metaphase**: Chromosomes align at the metaphase plate.
    *   **Anaphase**: Sister chromatids separate.
    *   **Telophase**: Nuclear envelopes reform, chromosomes decondense.
*   **Meiosis**: Produces four genetically unique haploid gametes. Used for sexual reproduction.
    *   **Meiosis I**: Homologous chromosomes separate (Reduction division).
    *   **Meiosis II**: Sister chromatids separate (similar to mitosis).
    *   **Genetic Variation**: Achieved through crossing over (Prophase I) and independent assortment (Metaphase I).
        `
      }
    ]
  },
  {
    id: 'genetics',
    title: '3. GENETICS AND MOLECULAR BIOLOGY',
    subTopics: [
      {
        id: '3.1',
        title: '3.1 Patterns of Inheritance',
        content: `
### 3.1 Patterns of Inheritance
*   **Mendelian Genetics**: Gregor Mendel's laws.
    *   **Law of Segregation**: Alleles separate during gamete formation.
    *   **Law of Independent Assortment**: Genes for different traits assort independently.
*   **Terminology**: Genotype (genetic makeup), Phenotype (physical expression), Homozygous (identical alleles), Heterozygous (different alleles).
*   **Non-Mendelian Inheritance**: Incomplete dominance, codominance, multiple alleles, polygenic inheritance, sex-linked traits.
        `
      },
      {
        id: '3.2',
        title: '3.2 Molecular Basis of Inheritance',
        relatedTo: ['3.3', '2.5'],
        content: `
### 3.2 Molecular Basis of Inheritance
*   **DNA Structure**: Double helix (Watson-Crick model), antiparallel strands, base pairing (A-T, C-G).
*   **DNA Replication**: Semiconservative model. Helicase (unwinds), DNA polymerase (synthesizes new strand), Primase (RNA primer), Ligase (joins fragments).
        `
      },
      {
        id: '3.3',
        title: '3.3 The Central Dogma',
        content: `
### 3.3 The Central Dogma
*   **Transcription**: DNA to mRNA. Occurs in the nucleus. RNA polymerase synthesizes mRNA.
*   **Translation**: mRNA to protein. Occurs in the cytoplasm (ribosomes). tRNA brings amino acids based on mRNA codons.
*   **Genetic Code**: Degenerate, universal, non-overlapping.
        `
      },
      {
        id: '3.4',
        title: '3.4 Gene Regulation',
        content: `
### 3.4 Gene Regulation
*   **Prokaryotic**: Operon model (e.g., Lac operon). Inducible and repressible systems.
*   **Eukaryotic**: Complex regulation at multiple levels (chromatin remodeling, transcriptional control, RNA processing, translational control, protein degradation).
        `
      }
    ]
  },
  {
    id: 'evolution-diversity',
    title: '4. EVOLUTION AND DIVERSITY OF LIFE',
    subTopics: [
      {
        id: '4.1',
        title: '4.1 Evolution and Speciation',
        content: `
### 4.1 Evolution and Speciation
*   **Evolution**: The process of gradual change during which new species arise from older species.
*   **Natural Selection**: Mechanism of evolution. Individuals with advantageous traits have greater reproductive success.
*   **Evidence for Evolution**: Fossil record, comparative anatomy (homologous structures), embryology, molecular biology (DNA sequences).
*   **Speciation**: Formation of new species. Allopatric (geographic isolation) and Sympatric (reproductive isolation within same area).
        `
      },
      {
        id: '4.2',
        title: '4.2 Taxonomy and Classification',
        content: `
### 4.2 Taxonomy and Classification
*   **Taxonomy**: Proposed by Carl Linnaeus. Hierarchical system: Domain, Kingdom, Phylum, Class, Order, Family, Genus, Species.
*   **Binomial Nomenclature**: Two-part naming system (Genus species).
*   **Phylogeny**: Evolutionary history of a species. Phylogenetic trees represent evolutionary relationships based on genetic or physical traits.
*   **Three Domains of Life**: Bacteria, Archaea, Eukarya.
        `
      }
    ]
  },
  {
    id: 'biotechnology',
    title: '5. BIOTECHNOLOGY',
    subTopics: [
      {
        id: '5.1',
        title: '5.1 Basic Techniques',
        content: `
### 5.1 Basic Techniques
*   **PCR (Polymerase Chain Reaction)**: Amplifies specific DNA sequences.
*   **Gel Electrophoresis**: Separates DNA fragments by size using an electric field.
*   **Recombinant DNA Technology**: Insertion of foreign DNA into a vector (plasmid) to create transgenic organisms.
*   **CRISPR-Cas9**: Gene editing technology for precise modification of DNA sequences.
        `
      }
    ]
  },
  {
    id: 'animal-systems',
    title: '6. ANIMAL FORM AND FUNCTION (SURVEY)',
    subTopics: [
      {
        id: '6.1',
        title: '6.1 Organ Systems Overview',
        content: `
### 6.1 Organ Systems Overview
*   **Circulatory System**: Transport of nutrients, gases, and wastes (heart, vessels, blood).
*   **Respiratory System**: Gas exchange ($O_2/CO_2$) (lungs, gills, trachea).
*   **Digestive System**: Breakdown of food into absorbable nutrients (stomach, intestines, liver).
*   **Excretory System**: Removal of metabolic wastes and osmotic balance (kidneys, bladder).
*   **Nervous System**: Processing information and controlling responses (brain, spinal cord, nerves).
*   **Endocrine System**: Chemical signaling via hormones (glands, hormones).
        `
      }
    ]
  },
  {
    id: 'plant-systems',
    title: '7. PLANT FORM AND FUNCTION (SURVEY)',
    subTopics: [
      {
        id: '7.1',
        title: '7.1 Plant Structure and Transport',
        content: `
### 7.1 Plant Structure and Transport
*   **Plant Tissues**: Dermal, vascular (xylem, phloem), and ground tissues.
*   **Transport**: Xylem transports water/minerals (transpiration pull); Phloem transports sugars (pressure-flow hypothesis).
*   **Reproduction**: Alternation of generations (sporophyte/gametophyte), flowering plant reproduction (pollination, fertilization, seed/fruit development).
        `
      }
    ]
  }
];

export const BIO102_SYLLABUS: Module[] = [
  {
    id: 'ecology',
    title: '1. ECOLOGY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Ecosystems',
        content: `
### 1.1 Ecosystems
An ecosystem consists of all the living things in a given area, interacting with each other, and also with their non-living environments.
*   **Biotic Factors**: Living components (plants, animals, bacteria).
*   **Abiotic Factors**: Non-living components (sunlight, temperature, soil).
*   **Energy Flow**: Food chains and food webs.
        `
      }
    ]
  },
  {
    id: 'plant-bio',
    title: '2. PLANT BIOLOGY',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Plant Structure',
        content: `
### 2.1 Plant Structure
Plants are multicellular eukaryotes that produce their own food through photosynthesis.
*   **Roots**: Anchor the plant and absorb water/minerals.
*   **Stems**: Support the plant and transport substances.
*   **Leaves**: Primary site of photosynthesis.
        `
      }
    ]
  }
];

export const BIO107_SYLLABUS: Module[] = [
  {
    id: 'micro-intro',
    title: '1. INTRODUCTION TO MICROBIOLOGY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Microbial World',
        content: `
### 1.1 Microbial World
Microbiology is the study of microscopic organisms, such as bacteria, viruses, archaea, fungi and protozoa.
*   **Bacteria**: Single-celled prokaryotes.
*   **Viruses**: Acellular entities that require a host to replicate.
*   **Fungi**: Eukaryotic organisms that can be unicellular (yeast) or multicellular (molds).
        `
      }
    ]
  }
];

export const BIO108_SYLLABUS: Module[] = [
  {
    id: 'anatomy-intro',
    title: '1. HUMAN ANATOMY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Skeletal System',
        content: `
### 1.1 Skeletal System
The human skeletal system provides structure, protection, and movement.
*   **Bones**: Rigid organs that form the skeleton.
*   **Joints**: Where two or more bones meet.
*   **Functions**: Support, protection of organs, blood cell production.
        `
      }
    ]
  },
  {
    id: 'physiology-intro',
    title: '2. HUMAN PHYSIOLOGY',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Circulatory System',
        content: `
### 2.1 Circulatory System
The circulatory system transports oxygen, nutrients, and hormones to cells throughout the body.
*   **Heart**: The muscular organ that pumps blood.
*   **Blood Vessels**: Arteries, veins, and capillaries.
*   **Blood**: The fluid that carries substances.
        `
      }
    ]
  }
];

export const PHY101_SYLLABUS: Module[] = [
  {
    id: 'mechanics',
    title: '1. MECHANICS',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Units and Dimensions',
        content: ``
      },
      {
        id: '1.2',
        title: '1.2 Linear Motion',
        content: ``
      }
    ]
  }
];

export const PHY102_SYLLABUS: Module[] = [
  {
    id: 'electricity',
    title: '1. ELECTRICITY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Electrostatics',
        content: `Coulomb's Law, Electric Field, and Potential.`
      },
      {
        id: '1.2',
        title: '1.2 Current Electricity',
        content: `Ohm's Law, Kirchhoff's Laws, and circuits.`
      }
    ]
  },
  {
    id: 'magnetism',
    title: '2. MAGNETISM',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Magnetic Fields',
        content: `Biot-Savart Law, Ampere's Law.`
      },
      {
        id: '2.2',
        title: '2.2 Electromagnetic Induction',
        content: `Faraday's Law, Lenz's Law.`
      }
    ]
  }
];

export const PHY103_SYLLABUS: Module[] = [
  {
    id: 'properties-of-matter',
    title: '1. PROPERTIES OF MATTER',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Elasticity',
        content: `Hooke's Law, Young's Modulus, Bulk Modulus.`
      },
      {
        id: '1.2',
        title: '1.2 Fluid Mechanics',
        content: `Density, Pressure, Archimedes' Principle.`
      }
    ]
  },
  {
    id: 'thermal-physics',
    title: '2. THERMAL PHYSICS',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Heat and Temperature',
        content: `Thermometry, Thermal Expansion.`
      },
      {
        id: '2.2',
        title: '2.2 Thermodynamics',
        content: `Laws of Thermodynamics, Heat Transfer.`
      }
    ]
  }
];

export const PHY108_SYLLABUS: Module[] = [
  {
    id: 'optics-lab',
    title: '1. OPTICS EXPERIMENTS',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Reflection and Refraction',
        content: `
### 1.1 Reflection and Refraction
Study of light behavior at interfaces.
*   **Snell\'s Law**: $n_1 \\sin \\theta_1 = n_2 \\sin \\theta_2$.
*   **Total Internal Reflection**: Occurs when light travels from denser to rarer medium at angle greater than critical angle.
        `
      }
    ]
  }
];

export const PHY104_SYLLABUS: Module[] = [
  {
    id: 'relativity',
    title: '1. Special Relativity',
    subTopics: [
      { id: '1.1', title: '1.1 Postulates of Special Relativity', content: `` },
      { id: '1.2', title: '1.2 Lorentz Transformations', content: `` }
    ]
  },
  {
    id: 'quantum-intro',
    title: '2. Introduction to Quantum Theory',
    subTopics: [
      { id: '2.1', title: '2.1 Photoelectric Effect', content: `` },
      { id: '2.2', title: '2.2 Wave-Particle Duality', content: `` }
    ]
  }
];

export const CHM101_SYLLABUS: Module[] = [
  {
    id: 'atomic-structure',
    title: '1. ATOMIC STRUCTURE',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Atoms and Elements',
        content: ``
      },
      {
        id: '1.2',
        title: '1.2 Periodic Table',
        content: ``
      }
    ]
  }
];

export const CHM102_SYLLABUS: Module[] = [
  {
    id: 'organic-intro',
    title: '1. INTRODUCTION TO ORGANIC CHEMISTRY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Hydrocarbons',
        content: ``
      }
    ]
  },
  {
    id: 'functional-groups',
    title: '2. FUNCTIONAL GROUPS',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Alcohols and Acids',
        content: ``
      }
    ]
  }
];

export const CHM107_SYLLABUS: Module[] = [
  {
    id: 'lab-safety',
    title: '1. LABORATORY SAFETY AND TECHNIQUES',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Safety Rules',
        content: `
### 1.1 Safety Rules
Safety is paramount in the chemistry laboratory.
*   **Personal Protective Equipment (PPE)**: Lab coats, goggles, and gloves.
*   **Chemical Handling**: Proper techniques for pouring and mixing chemicals.
        `
      }
    ]
  }
];

export const CHM108_SYLLABUS: Module[] = [
  {
    id: 'qualitative-analysis',
    title: '1. QUALITATIVE ANALYSIS',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Identification of Ions',
        content: `
### 1.1 Identification of Ions
Techniques for identifying cations and anions in a sample.
*   **Flame Tests**: Identifying metal ions by the color of the flame.
*   **Precipitation Reactions**: Using chemical reagents to form insoluble solids.
        `
      }
    ]
  }
];

export const COS101_SYLLABUS: Module[] = [
  {
    id: 'intro-computing',
    title: '1. INTRODUCTION TO COMPUTING',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 History of Computers',
        content: `
### 1.1 History of Computers
The evolution of computers from mechanical devices to modern microprocessors.
*   **Generations**: Vacuum tubes, transistors, integrated circuits, microprocessors.
*   **Key Figures**: Charles Babbage, Ada Lovelace, Alan Turing.
        `
      },
      {
        id: '1.2',
        title: '1.2 Computer Hardware',
        content: `
### 1.2 Computer Hardware
Physical components of a computer system.
*   **CPU**: Central Processing Unit (The Brain).
*   **Memory**: RAM (Volatile) and ROM (Non-volatile).
*   **Storage**: HDD, SSD, and external drives.
        `
      }
    ]
  }
];

export const COS102_SYLLABUS: Module[] = [
  {
    id: 'problem-solving',
    title: '1. PROBLEM SOLVING & ALGORITHMS',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Algorithms',
        content: `
### 1.1 Algorithms
A step-by-step procedure for solving a problem.
*   **Properties**: Finiteness, definiteness, input, output, effectiveness.
*   **Representation**: Pseudocode and Flowcharts.
        `
      },
      {
        id: '1.2',
        title: '1.2 Programming Basics',
        content: `
### 1.2 Programming Basics
Introduction to programming concepts.
*   **Variables**: Named storage locations for data.
*   **Control Structures**: If-else statements, loops (for, while).
*   **Functions**: Reusable blocks of code.
        `
      }
    ]
  }
];

export const GST111_SYLLABUS: Module[] = [
  {
    id: 'speaking-phonetics-phonology',
    title: '1. SPEAKING, PHONETICS & PHONOLOGY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 The Notion of Speaking',
        content: `
### 1.1 The Notion of Speaking
It is no doubt that the production of the human speech evolves in the human brain and involves some brain activities. Before speaking, the human brain quickly and precisely coordinates the lips, jaw, tongue and larynx (voice box). The part of the human brain which performs this task and controls the human speech is called the **ventral sensorimotor cortex, or vSMC**. Researchers have discovered that the vSMC controls some part of the face and mouth (Wein, 2013). 

According to Bock (1995), speech production refers to the cognitive processes engaged in going from mind to mouth, that is, the processes transforming a nonlinguistic conceptual structure representing a communicative intention into a linguistically well-formed utterance. Speaking or speech production, is a highly complex motor act involving the finely coordinated activation of approximately 100 muscles in the respiratory, laryngeal, and oral motor systems (Guenther & Hickok, 2016). 

The opinions of Bock (1995), Wien (2013) and Guenther and Hickok (2016) have proven the involvement of the somato-sensory system in speech production. This explains why the organs in the pharyngeal cavity (oesophagus, glottis, larynx, voice-box, trachea), oral cavity (tongue, lips, teeth, palate, velum), and nasal cavity (nostrils) are involved in speech making. 

Therefore, when we speak, we produce speech sounds, hence, the conceptualization of speaking as "Speech Production". Speech involves the vocalizing of specific sounds called **phonemes**. Every language has specific phonemes that make sounds for that language. Speech is not limited to phonemes. Speech sounds are the vocal sounds we use to make up the words of the English language. We use them every time we say a word out loud. Saying the right sounds in the right order is what allows us to communicate with other people and understand what they are saying.
        `
      },
      {
        id: '1.2',
        title: '1.2 Mechanisms of Speech',
        content: `
### 1.2 Mechanisms of Speech
Speaking is simply the process of speech making. Speech is often produced by the air stream from the lungs, which goes through the trachea and the oral and nasal cavities. Naturally, speech does not start in the lungs of humans but in the human brain. The message is first of all created in the human mind. Subsequently, a representation of the message by sound sequence is formed in our minds. This is connected by a number of commands in our brain connected to the speech organs which will eventually produce the utterance (Belinchón & Igoa y Rivière). The mental activity precedes the physical production of sounds, that is the production of the sounds constituting the utterance by the air stream from the lungs, which goes through the trachea and the oral and nasal cavities.

Four processes are involved in speech making:
1.  **Initiation**: The moment when the air is expelled from the lungs. In English, speech sounds are the result of a "**pulmonic egressive air stream**" (Giegerich, 1992) although that is not the case in all languages (ingressive sounds).
2.  **Phonation**: Occurs at the larynx. The larynx has two horizontal folds of tissue in the passage of air; they are the **vocal folds**. The gap between these folds is called the **glottis**.
3.  **Oro-nasal Process**: The directing of air through either the oral cavity (mouth) or nasal cavity (nose).
4.  **Articulation**: The final stage where sounds are shaped into recognizable speech by the articulators.
        `
      },
      {
        id: '1.3',
        title: '1.3 What Is Phonetics?',
        content: `
### 1.3 What Is Phonetics?
The term, "PHONETICS", simply describes the science or study of speech sounds and their production, transmission, and reception, and their analysis, classification, and transcription. In other words, Phonetics is the branch of linguistics that deals with the sounds of speech and their production, combination, description, and representation by written symbols.

Because we knew little about what happens in the human brain when we are speaking, the science of phonetics has concentrated on the three central components of the speech chain, which are:
1.  **Acoustic Phonetics**: The study of the physical properties of speech sounds (frequency, amplitude, duration) as they travel through the air as sound waves.
2.  **Articulatory Phonetics**: The study of how speech sounds are produced by the movement of various parts of the vocal tract (articulators).
3.  **Auditory Phonetics**: The study of how speech sounds are perceived and heard by the ear, brain, and auditory nerve.

Traditionally, phoneticians relied on their capabilities to study sound production and perception by monitoring ears and eyes movements as well as observing other vocal organs to study pronunciation. More recently, however, the study of sound production and perception have been carried out using instruments of various types (Experimental Phonetics) to supplement the information derivable from the study of the physical sensations.
        `
      },
      {
        id: '1.4',
        title: '1.4 Articulatory Phonetics & Organs',
        content: `
### 1.4 Articulatory Phonetics & Organs
Articulatory phonetics is interested in the movement of various parts of the vocal tract during speech. The vocal tract is the passages above the larynx where air passes in the production of speech. In simpler terms, it is understanding which part of the mouth moves when we make a sound.

The organs that help us to produce speech sounds are called **articulators**. Some of them are: lips, teeth, tongue, alveolar ridge, hard palate, soft palate, nasal passage, glottal folds, and lungs.

**Key Organs and Functions:**
*   **The Lungs**: A bladder-like spongy organ filled with air located on both sides of the chest. The lungs can expand or contract by ingression or egression of air. Air passes from the lungs through the trachea to the oral or nasal cavity.
*   **The Larynx**: Located behind Adam’s apple. The vocal cords (or vocal folds), also regarded as the voice box, are a part of the larynx.
*   **The Pharynx**: Contains all the active and passive articulators. It is a tube-like structure with two ends regarded as the nasal and oral cavities. The entire part from the pharynx to the mouth is called the vocal tract.
        `
      },
      {
        id: '1.5',
        title: '1.5 The Concept of Phonology',
        content: `
### 1.5 The Concept of Phonology
Phonology studies the system of contrastive relationships among the speech sounds that constitute the fundamental components of a language. In other words, phonology is the study of the existing sounds in a language and across different languages. Apart from this, phonology is the study of how sounds in a language are categorised, organised and used to convey meaning.

**Key Concepts:**
*   **Phonemes**: The meaningfully different sound units in a language (the smallest units of sound). For example, ‘pat’ and ‘bat’ differ in their first phoneme: the /p/ and /b/. Vowels are also phonemes, so “pat” and “pet” differ by a phoneme, too.
*   **Minimal Pair**: When two words differ by a single phoneme (e.g., 'pat' and 'bat').
*   **Allophones**: Variants of the same phoneme. It refers to the different ways of pronouncing a phoneme based on its environment in a word. For example, the two allophones of /l/ in “little” are produced slightly differently due to the environment.
        `
      },
      {
        id: '1.6',
        title: '1.6 Branches of Phonology & Prosody',
        content: `
### 1.6 Branches of Phonology & Prosody
Phonology is divided into two main branches:
1.  **Segmental Phonology**: Concerned with the smallest units of sound (phonemes) and their distribution and patterns within words. It examines phones and allophones. Segmental inventories of English include vowels and consonants.
2.  **Suprasegmental Phonology (Prosody)**: Concerned with features that extend more than one segment, such as intonation, stress, and rhythm.

**Suprasegmental Features:**
*   **Pitch**: The perceived frequency of a sound. In English, pitch differentiates between statements, questions, and exclamatory expressions.
*   **Stress**: The emphasis placed on a particular syllable or word.
    *   **Stressed syllables**: Pronounced more forcefully, with higher pitch and longer duration.
    *   **Word stress**: Crucial for multi-syllable words (e.g., *in*-crease vs. in-*crease*).
    *   **Sentence stress**: Focus on content words (nouns, main verbs, adjectives).
*   **Intonation**: The variation in pitch across a phrase or sentence.
    *   **Falling Tune**: Decrease in pitch at the end (statements/commands).
    *   **Rising Tune**: Increase in pitch at the end (yes/no questions/requests).
    *   **Fall-Rise**: Decrease then increase (uncertainty).
    *   **Rise-Fall**: Initial rise then decline (strong emotions).
*   **Rhythm**: The pattern of stressed and unstressed syllables, shaping the flow and tempo of spoken language.
        `
      }
    ]
  },
  {
    id: 'english-sound-system',
    title: '2. ENGLISH SOUND SYSTEM (CONSONANTS & VOWELS)',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Consonant Sounds',
        content: `
### 2.1 Consonant Sounds
Consonants are sounds produced by setting air in motion from the lungs, where the air passage is blocked totally or partially before it leaves the mouth (by the tongue, lips, or throat).

**Classification Parameters:**
1.  **Place of Articulation**:
    *   **Bilabial**: Upper and lower lips in contact (e.g., /p/, /b/, /m/, /w/).
    *   **Dental**: Tip of tongue touches teeth (e.g., /θ/, /ð/).
    *   **Labio-dental**: Lower lip and upper teeth (e.g., /f/, /v/).
    *   **Alveolar**: Tip/blade of tongue touches alveolar ridge (e.g., /t/, /d/, /s/, /z/, /n/, /l/, /r/).
    *   **Palatal**: Body of tongue touches hard palate (e.g., /j/).
    *   **Palato-alveolar**: Blade/tip at alveolar ridge, body approaches hard palate (e.g., /ʃ/, /ʒ/, /tʃ/, /dʒ/).
    *   **Velar**: Body of tongue touches soft palate/velum (e.g., /k/, /g/, /ŋ/).
    *   **Glottal**: Vocal cords produce friction (e.g., /h/).

2.  **Manner of Articulation**:
    *   **Plosive**: Air blocked then released (e.g., /p/, /b/, /t/, /d/, /k/, /g/).
    *   **Fricative**: Air partially blocked, creating friction (e.g., /f/, /v/, /θ/, /ð/, /s/, /z/, /ʃ/, /ʒ/, /h/).
    *   **Affricate**: Combination of plosive and fricative (e.g., /tʃ/, /dʒ/).
    *   **Nasal**: Air escapes through the nose (e.g., /m/, /n/, /ŋ/).
    *   **Lateral**: Air escapes from the sides of the tongue (e.g., /l/).
    *   **Approximant**: Articulators approach but don't touch (e.g., /w/, /r/, /j/).

There are **24 consonant sounds** in English.
        `
      },
      {
        id: '2.2',
        title: '2.2 Vowel Sounds: Monophthongs',
        content: `
### 2.2 Vowel Sounds: Monophthongs
Vowels are produced through the flow of air directed into different parts of the mouth. All vowels are **voiced** in English.

**Types of Vowels:**
1.  **Monophthongs (Pure Vowels)**: Single sounds that remain constant throughout pronunciation. There are 12 in English.
2.  **Diphthongs**: Combinations of two monophthongs.
3.  **Triphthongs**: Combinations of three monophthongs.

**Classification of Monophthongs:**
*   **Long Vowels** (marked with diacritic [:]): /i:/ (see), /a:/ (far), /u:/ (pool), /3:/ (bird), /ɔ:/ (store).
*   **Short Vowels**: /ɪ/ (pin), /e/ (ten), /æ/ (mad), /ə/ (believe), /ʌ/ (bus), /ʊ/ (look), /ɒ/ (dog).

**Vowel Chart Positions:**
*   **Front Vowels**: /i:/, /ɪ/, /e/, /æ/.
*   **Central Vowels**: /ə/, /3:/, /ʌ/.
*   **Back Vowels**: /u:/, /ʊ/, /ɔ:/, /ɒ/, /a:/.
        `
      },
      {
        id: '2.3',
        title: '2.3 Diphthongs & Triphthongs',
        content: `
### 2.3 Diphthongs & Triphthongs
Diphthongs are combinations of two monophthongs involving a gradual change in quality and length (gliding vowels). There are **8 diphthongs** in English:
*   /eɪ/ (late, gate)
*   /ɪə/ (dear, fear)
*   /eə/ (fair, care)
*   /ʊə/ (sure, cure)
*   /əʊ/ (globe, show)
*   /ɔɪ/ (join, coin)
*   /aɪ/ (time, rhyme)
*   /aʊ/ (cow, how)

**Categories of Diphthongs:**
*   **Falling**: Begin with higher pitch/volume and end lower (e.g., /aɪ/).
*   **Rising**: Vowel follows a semivowel (/j/ or /w/).
*   **Closing**: Second vowel is more 'closed' (higher position) than the first (e.g., /eɪ/, /aɪ/, /ɔɪ/, /əʊ/, /aʊ/).
*   **Centring**: End with the schwa sound /ə/ (e.g., /ɪə/, /eə/, /ʊə/).
*   **Wide**: Large tongue movement between sounds (e.g., /aɪ/, /aʊ/).

**Triphthongs**: A combination of three monophthongs (e.g., /aɪə/ in 'fire', /aʊə/ in 'hour').
        `
      }
    ]
  },
  {
    id: 'sentence-construction',
    title: '3. SENTENCE CONSTRUCTION & TYPES',
    subTopics: [
      {
        id: '3.1',
        title: '3.1 The Meaning of a Sentence',
        content: `
### 3.1 The Meaning of a Sentence
A sentence originates from a group of words that is complete in itself, typically containing a subject and predicate, conveying a statement, question, exclamation, or command. It consists of a main clause and sometimes one or more subordinate clauses.

**Key Characteristics:**
*   Starts with a capital letter.
*   Ends with a period (.), question mark (?), or exclamation mark (!).
*   Requires at least one subject and one verb.
*   The **verb** is regarded as the "heart" of a sentence.

**Examples:**
1. Derayo must write us a letter.
2. Where is Chioma’s pen?
3. This is incredible!
4. Ade and I are working on a project.
        `
      },
      {
        id: '3.2',
        title: '3.2 Basic Sentence Structure',
        content: `
### 3.2 Basic Sentence Structure
Every word in a sentence serves a specific purpose. The basic parts of a sentence are the **Subject** and the **Predicate**.

*   **Subject**: The person, place, or thing performing the action. It represents what or whom the sentence is about. Usually contains a noun or pronoun.
*   **Predicate**: Expresses action within the sentence. It contains the verb and often an object.
*   **Verb**: The action of the sentence.
*   **Object**: Whoever or whatever receives the action.

**Structural Elements (Modern Grammar):** S + V + O + C + A (Subject, Verb, Object, Complement, Adjunct).
**Structural Elements (Systemic Functional):** S + P + C + A (Subject, Predicator, Complement, Adjunct).

**Examples:**
*   "The Police Officer (S) / is very competent (P)."
*   "The dog (S) / barks till day break (P)."
        `
      },
      {
        id: '3.3',
        title: '3.3 Direct Object',
        content: `
### 3.3 Direct Object
The direct object receives the action of the sentence. It is usually a noun, pronoun, or noun phrase. 
**Guide:** Subject + Verb + Who or What?

**Examples:**
*   "Bola beats **the boy**." (Subject: Bola, Verb: beats, Object: the boy).
*   "Al-amin loves **sitting by the sea**."
*   "Omolabi hugged **him** with all his might."
        `
      },
      {
        id: '3.4',
        title: '3.4 Structural Types of a Sentence',
        content: `
### 3.4 Structural Types of a Sentence
Sentences are categorized by their clause structure:
1.  **Simple Sentence**: Has a single independent clause (one verb) and cannot take another clause.
    *   *Example:* "I always wanted to become a writer."
2.  **Compound Sentence**: Two or more independent clauses joined by a conjunction (and, but, so) or punctuation (semicolon).
    *   *Example:* "Our house will host you, so you are most welcome."
3.  **Complex Sentence**: Contains one independent clause and at least one dependent clause (cannot stand alone).
    *   *Example:* "Aminu was happy to have won the prize, even though the prize is a pen."
4.  **Compound-Complex Sentence**: Two or more independent clauses and at least one dependent clause. This is the most complicated type.
    *   *Example:* "Ada doesn’t like vegetables because it makes her sick, so she doesn’t eat it."
        `
      },
      {
        id: '3.5',
        title: '3.5 Functional Types of Sentences',
        content: `
### 3.5 Functional Types of Sentences
Categorized by the meaning or purpose they convey:
1.  **Declarative**: Makes a statement or gives information. Ends with a full stop.
    *   *Example:* "The boy is a perfectionist."
2.  **Interrogative**: Asks a question. Ends with a question mark. Marked by inversion of subject and predicate.
    *   *Example:* "Is the boy a perfectionist?"
3.  **Imperative**: Gives orders, commands, instructions, or advice. Ends with a full stop or exclamation mark.
    *   *Example:* "Leave him alone!"
4.  **Exclamatory**: Shows strong emotions (excitement, surprise, anger). Ends with an exclamation mark (!).
    *   *Example:* "I got an A in GNS 101!"
        `
      }
    ]
  },
  {
    id: 'reported-speech-full',
    title: '4. DIRECT AND INDIRECT SPEECH',
    subTopics: [
      {
        id: '4.1',
        title: '4.1 Introduction to Reporting',
        content: `
### 4.1 Introduction to Reporting
As a Speaker of English, you have two ways of reporting words: **Direct Quote** (Direct Speech) and **Indirect Quote** (Indirect Speech).
*   **Direct Speech**: Contains the exact words spoken by another person.
*   **Indirect Speech**: Expresses the content of what was said, but not the exact words.
        `
      },
      {
        id: '4.2',
        title: '4.2 Rules of Direct Speech',
        content: `
### 4.2 Rules of Direct Speech
1. After the subject (speaker) and the verb, put a comma.
2. Put quotation marks before the first word of the quoted speech.
3. Write the first letter of the first quoted word in capital letters.
4. Put appropriate punctuation (., ?, !) at the end of the speech inside the marks.
5. Close the speech with quotation marks.

**Example:** “I shall probably go to Lapai next week”, said the lecturer.
        `
      },
      {
        id: '4.3',
        title: '4.3 Rules of Indirect Speech',
        content: `
### 4.3 Rules of Indirect Speech
Indirect speech (Reported Speech) involves paraphrasing an utterance without quoting verbatim.
1. No quotation marks are used.
2. The reported speech is often introduced with the conjunction "**that**".
3. Do not distort the original meaning.
4. **Tense Shifts**: After a past verb in the reporting clause, the verb form usually changes (e.g., "go" becomes "went").
5. **Modal Shifts**: "can" -> "could", "may" -> "might", "will" -> "would".

**Example:** The lecturer said that he would probably go to Lapai the following week.
        `
      }
    ]
  },
  {
    id: 'grammar-word-classes-full',
    title: '5. GRAMMAR & WORD CLASSES',
    subTopics: [
      {
        id: '5.1',
        title: '5.1 Introduction to Grammar',
        content: `
### 5.1 Introduction to Grammar
Grammar refers to the systematic rules about how a language should be written or spoken. It is the study of the relationship between words in a sentence and the principles that govern sentence construction. It teaches us how a language is spoken and written correctly and effectively.
        `
      },
      {
        id: '5.2',
        title: '5.2 Scope of Grammar',
        content: `
### 5.2 Scope of Grammar
The scope is very wide and includes:
*   Gender, number, and case in nouns.
*   Voice, mood, tense, and aspect in verbs.
*   Complementation between verbs and nouns/adjectives.
*   Modification between adjectives/nouns and adverbs/verbs.
*   Determination between determiners and nouns.
*   Sentence embedding and other processes.
        `
      },
      {
        id: '5.3',
        title: '5.3 Types of Grammar',
        content: `
### 5.3 Types of Grammar
1.  **Traditional/Modern Grammar**: Prescriptive and notional. Sets up parts of speech and relates units.
2.  **Structural Grammar**: Eliminates meaning from descriptions. Uses contrast and minimal pairs to identify morphemes and slots.
3.  **Generative Grammar**: Seeks to generate all and only grammatical sentences using phrase-structure rules. Highly mentalistic.
4.  **Systemic Functional Grammar**: Conceives language as a system of choices (network of choices) matching form to function in social contexts.
        `
      },
      {
        id: '5.4',
        title: '5.4 Word Classes (Parts of Speech)',
        content: `
### 5.4 Word Classes (Parts of Speech)
Every word in English falls into a particular group or class based on its function.
*   **Open Class (Major)**: Nouns, Verbs, Adjectives, Adverbs. New words can be added.
*   **Closed Class (Minor)**: Pronouns, Prepositions, Conjunctions, Determiners, Interjections. Fixed set of words.
        `
      }
    ]
  },
  {
    id: 'nouns-verbs-full',
    title: '6. NOUNS & VERBS',
    subTopics: [
      {
        id: '6.1',
        title: '6.1 Nouns: Types & Pluralization',
        content: `
### 6.1 Nouns: Types & Pluralization
A noun is a naming word for people, places, or things.
**Types of Nouns:**
1.  **Proper Nouns**: Specific people/places (Stephen, Nigeria). Written with initial capital.
2.  **Common Nouns**: General categories (Car, Dog).
3.  **Concrete Nouns**: Physical things that can be observed/measured (Guitar, Table).
4.  **Abstract Nouns**: Ideas, processes, qualities (Happiness, Love).
5.  **Count Nouns**: Have singular and plural forms.
6.  **Non-count Nouns**: Substances/qualities with no plural form (Silver, Information).
7.  **Collective Nouns**: Groups (A crowd of people, A fleet of cars).

**Pluralization Rules:**
*   -y -> -ies (story -> stories).
*   -o, -s, -sh, -tch, -x -> add -es (box -> boxes).
*   -f/-fe -> -ves (knife -> knives).
*   Irregular: mutation (man -> men) or no change (sheep -> sheep).
        `
      },
      {
        id: '6.2',
        title: '6.2 The Possessive Case',
        content: `
### 6.2 The Possessive Case
Used to show possession using the apostrophe:
*   Add **'s** to singular and plural nouns not ending in -s (A child’s voice, Men’s clothes).
*   Add **'** alone to plural nouns ending in -s (A girls’ school).
*   Nouns ending in 's' can take **'** alone (Mr. Jones’ house).
*   Compound nouns: last word takes **'s** (my brother-in-law’s guitar).
        `
      },
      {
        id: '6.3',
        title: '6.3 Verbs: Lexical & Auxiliary',
        content: `
### 6.3 Verbs: Lexical & Auxiliary
The verb is the nucleus of the English clause.
*   **Lexical Verbs**: Main verbs (talk, play). Have 5 forms: Base (V), -s form, Past (V-ed1), -ing participle, -ed participle (V-ed2).
*   **Auxiliary Verbs**:
    *   **Primary**: do, have, be.
    *   **Modal**: can, could, may, might, shall, should, will, would, must, ought to, used to, need, dare.
*   **"Be" forms**: am, is, are, was, were, being, been.
        `
      },
      {
        id: '6.4',
        title: '6.4 Finite & Non-Finite Verbs',
        content: `
### 6.4 Finite & Non-Finite Verbs
*   **Finite Verbs**: Marked for tense and show agreement/concord with the subject. They have mood (Declarative, Imperative, Interrogative).
*   **Non-Finite Verbs**: Do not show tense/mood. Forms include: Infinitive (to play), -ing participle (playing), -ed participle (played), and bare infinitive.
        `
      },
      {
        id: '6.5',
        title: '6.5 Transitive & Intransitive Verbs',
        content: `
### 6.5 Transitive & Intransitive Verbs
*   **Transitive**: Transfer action to a direct object (e.g., "Ade kicked the ball").
*   **Intransitive**: Do not need a direct object (e.g., "Davido danced").
*   **Ditransitive**: Take two objects (e.g., "Ade gave Sammy the book").
        `
      }
    ]
  },
  {
    id: 'other-word-classes-full',
    title: '7. ADJECTIVES, ADVERBS, PREPOSITIONS & PRONOUNS',
    subTopics: [
      {
        id: '7.1',
        title: '7.1 Adjectives: Characteristics & Order',
        content: `
### 7.1 Adjectives: Characteristics & Order
Adjectives qualify nouns or pronouns, providing details on physical/psychological qualities.
*   **Position**: Attributive (before noun) or Predicative (after verb).
*   **Grading**: Positive, Comparative (-er/more), Superlative (-est/most).
*   **Order of Adjectives**: 
    1. Possessive/Demonstrative (my, this)
    2. Size (big)
    3. General description (dirty)
    4. Shape (round)
    5. Age (old)
    6. Colour (blue)
    7. Material (steel)
    8. Origin (Nigerian)
    9. Purpose (dining)
        `
      },
      {
        id: '7.2',
        title: '7.2 Adverbs: Kinds & Forms',
        content: `
### 7.2 Adverbs: Kinds & Forms
Adverbs modify verbs, adjectives, or other adverbs.
*   **Kinds**: Manner (how), Place (where), Time (when), Frequency (how often), Degree (to what extent), Reason (why), Condition, Concession, Result.
*   **Order**: Manner -> Direction -> Place -> Time.
        `
      },
      {
        id: '7.3',
        title: '7.3 Prepositions: Types & Positions',
        content: `
### 7.3 Prepositions: Types & Positions
Prepositions show relationships (mental, psychological, or location).
*   **Types**: Simple (in, on), Double (away from), Complex (in contact with), Disguised (ashore).
*   **Positions**: Usually before the word, but can be at the end in questions or relative clauses.
        `
      },
      {
        id: '7.4',
        title: '7.4 Pronouns: Functions & Classes',
        content: `
### 7.4 Pronouns: Functions & Classes
Pronouns replace noun phrases (NP).
*   **Classes**: Demonstratives (this), Interrogatives (who), Negation (nobody), Personal/Reflexive (I, myself), Reciprocal (each other), Relative (which), Quantifiers (some).
*   **Antecedent**: The word/phrase a pronoun refers to. Must agree in number.
*   **Person**: 1st (speaker), 2nd (spoken to), 3rd (spoken about).
        `
      },
      {
        id: '7.5',
        title: '7.5 Interjections',
        content: `
### 7.5 Interjections
Words that forcefully convey strong emotions or surprises. They interrupt the general flow and are usually punctuated with an exclamation point.
*   **Primary**: Single words (Wow, Hey, Yahoo).
*   **Secondary**: Phrases (Good God!, Alas!).
        `
      }
    ]
  },
  {
    id: 'logic-reasoning-full',
    title: '8. LOGIC & REASONING',
    subTopics: [
      {
        id: '8.1',
        title: '8.1 Logic & Rationality',
        content: `
### 8.1 Logic & Rationality
*   **Logic**: The study of the forms of correct inference (truth or falsity of a proposition). Facts are discernible through inference from existing facts.
*   **Rationality**: Understanding and interpreting actions based on present, past, and future situations through inquiry.
        `
      },
      {
        id: '8.2',
        title: '8.2 Syllogism',
        content: `
### 8.2 Syllogism
A logical argument applying deductive reasoning to arrive at a conclusion based on two assumed propositions (premises).
*   **Categorical Syllogism**: Simple declarative statements with three terms, each appearing twice.
*   **Aristotle's Figures**: Classification based on the middle term's relation to other terms (First, Second, Third figures).
        `
      },
      {
        id: '8.3',
        title: '8.3 Inductive Reasoning',
        content: `
### 8.3 Inductive Reasoning
Drawing inferences from existing instances to generalizations.
*   **Categories**:
    1. **Inductive Generalization**: Conclusion about a population from a sample.
    2. **Statistical Generalization**: Uses specific numbers (statistical syllogisms).
    3. **Causal Reasoning**: Cause-and-effect links.
    4. **Sign Reasoning**: Correlational connections (one event acts as a "sign").
    5. **Analogical Reasoning**: Drawing conclusions based on similarities.
        `
      },
      {
        id: '8.4',
        title: '8.4 Deductive Reasoning',
        content: `
### 8.4 Deductive Reasoning
Making inferences from general premises to specific conclusions. Starts with a theory, develops a hypothesis, and tests it empirically.
        `
      }
    ]
  },
  {
    id: 'ethics-writing-full',
    title: '9. ETHICS IN ADVANCED WRITING',
    subTopics: [
      {
        id: '9.1',
        title: '9.1 Overview of Ethics',
        content: `
### 9.1 Overview of Ethics
Moral considerations and principles directing the production, distribution, and reception of information. Transcends grammatical guidelines to deal with responsible use of information and effects on audiences.
        `
      },
      {
        id: '9.2',
        title: '9.2 Proper Use of Data & Inclusion',
        content: `
### 9.2 Proper Use of Data & Inclusion
*   **Data Use**: Avoiding misrepresentation and selective reporting. Transparency regarding conflicts of interest.
*   **Cultural Sensitivity**: Fostering inclusiveness, honoring variety, and avoiding prejudicial wording or stereotypes.
        `
      },
      {
        id: '9.3',
        title: '9.3 Copyright Infringement',
        content: `
### 9.3 Copyright Infringement
Legal protection for original works. Writers must be vigilant in respecting rights, avoiding infringement, and properly attributing sources. Digital technology adds challenges like online piracy.
        `
      },
      {
        id: '9.4',
        title: '9.4 Plagiarism: Definition & Types',
        content: `
### 9.4 Plagiarism: Definition & Types
Presenting someone else's work as one's own without credit.
*   **Types**:
    1. **Copy-Paste**: Directly lifting text.
    2. **Paraphrasing without Attribution**: Rewriting ideas without credit.
    3. **Patchwriting**: Merging phrases from multiple sources without integration.
    4. **Self-Plagiarism**: Submitting previously published work as new.
        `
      },
      {
        id: '9.5',
        title: '9.5 Consequences of Plagiarism',
        content: `
### 9.5 Consequences of Plagiarism
Penalties include: Academic Warning, Grade Deduction, Course Failure, Academic Probation, Educational Sanctions, Suspension, and Expulsion.
        `
      }
    ]
  },
  {
    id: 'writing-reading-ict-full',
    title: '10. WRITING, READING & ICT',
    subTopics: [
      {
        id: '10.1',
        title: '10.1 The Writing Process',
        content: `
### 10.1 The Writing Process
Writing involves several processes from planning to draft editing.
*   **Stages**:
    1. **Prewriting**: Topic selection, research, brainstorming (freewriting, graphic organizers), thesis development, organization.
    2. **Drafting**: Creating the first version.
    3. **Revising**: Evaluating the draft for clarity and logic.
    4. **Editing**: Polishing details, mechanics, and proofreading for typos.
    5. **Publishing**: Preparing the final product.
        `
      },
      {
        id: '10.2',
        title: '10.2 Types of Writing',
        content: `
### 10.2 Types of Writing
*   **Expository**: Explaining a concept (textbooks, recipes).
*   **Descriptive**: Painting a picture in words (poetry, novels).
*   **Persuasive**: Convincing the audience (academic papers, advertisements).
*   **Narrative**: Constructing a story (short stories, oral histories).
        `
      },
      {
        id: '10.3',
        title: '10.3 Mechanics of Writing',
        content: `
### 10.3 Mechanics of Writing
Rules guiding placement and arrangement of textual components:
*   **Paragraph structure**: Start with a topic sentence.
*   **Sentence length**: Keep short and simple.
*   **Pronouns**: Avoid ambiguity.
*   **Tense**: Past (work done), Present (report itself), Future (predictions).
        `
      },
      {
        id: '10.4',
        title: '10.4 Reading & Comprehension Skills',
        content: `
### 10.4 Reading & Comprehension Skills
*   **Reading Process**: Decoding symbols to get meaning.
*   **Key Features**: Decoding, Comprehension, Fluency, Vocabulary, Critical Thinking, Contextual Understanding.
*   **Comprehension Types**:
    1. **Literal**: Recalling explicit info.
    2. **Inferential**: Reading between the lines.
    3. **Critical**: Evaluating credibility and bias.
    4. **Analytical**: Breaking down structure and literary devices.
    5. **Reflective**: Connecting text to personal experience.
        `
      },
      {
        id: '10.5',
        title: '10.5 ICT in Language Education',
        content: `
### 10.5 ICT in Language Education
Information and Communication Technology (ICT) consists of hardware, software, and networks for information collection and transmission.
*   **Role**: Expands access to materials, improves quality, and offers autonomous learning.
*   **Tools**: Internet, multimedia, online learning platforms, and digital communication gear.
        `
      }
    ]
  }
];

export const GST112_SYLLABUS: Module[] = [
  {
    id: 'concept-culture',
    title: '1. CONCEPT OF CULTURE',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Definition and Elements of Culture',
        content: `
### 1.1 Definition and Elements of Culture
Culture is the bedrock of human identity and social organization. In an academic context, it is defined as the "total way of life" of a group of people.

*   **Anthropological Definition (Edward Tylor)**: "That complex whole which includes knowledge, belief, art, morals, law, custom, and any other capabilities and habits acquired by man as a member of society."
*   **Sociological Perspective**: Culture is the social heritage of a group, consisting of shared values, norms, and material objects that characterize a particular group.
*   **Elements of Culture**:
    1.  **Language**: The primary vehicle for cultural transmission. It shapes how we perceive reality.
    2.  **Religion and Belief Systems**: Provide a framework for understanding the universe and moral guidance.
    3.  **Values**: Abstract ideals about what is good, right, and desirable (e.g., respect for elders in Nigerian culture).
    4.  **Norms**: Rules and expectations by which a society guides the behavior of its members (Folkways, Mores, and Laws).
    5.  **Material Culture**: Physical objects created by a society (tools, technology, clothing, architecture).
    6.  **Social Organization**: The structure of relationships within a society (family, kinship, age grades).
        `
      },
      {
        id: '1.2',
        title: '1.2 Characteristics of Culture',
        content: `
### 1.2 Characteristics of Culture
Culture is not a static list of traits but a dynamic system with specific properties:

*   **Learned (Enculturation)**: Culture is not biological or instinctive. It is acquired through interaction with others and the environment.
*   **Shared**: It is a collective property. An individual's idiosyncratic behavior is not culture; it must be shared by a significant portion of the group.
*   **Symbolic**: Culture relies on symbols—anything that carries a particular meaning recognized by people who share a culture (e.g., the Nigerian flag, traditional titles).
*   **Integrated**: Various parts of a culture (economy, religion, family) are interconnected. A change in one part often triggers changes in others.
*   **Dynamic and Adaptive**: Culture is constantly evolving. It changes through internal innovation and external contact (diffusion). It helps humans adapt to their physical and social environments.
*   **Transgenerational**: It is passed down from one generation to the next, ensuring social continuity.
        `
      },
      {
        id: '1.3',
        title: '1.3 Cultural Universals',
        content: `
### 1.3 Cultural Universals
Despite the vast diversity of human societies, certain traits are found in every known culture. These are called cultural universals.

*   **Examples**:
    *   **Language**: Every culture has a complex system of communication.
    *   **Family Structure**: Every culture has a system for regulating reproduction and child-rearing.
    *   **Incest Taboo**: A near-universal prohibition against sexual relations between close kin.
    *   **Religion/Ritual**: Every culture has ways of addressing the supernatural or the "ultimate concerns" of life.
    *   **Art and Aesthetics**: Every culture expresses itself through music, dance, or visual arts.
    *   **Property Rights**: Every culture has rules about who can use or own resources.
*   **Significance**: Cultural universals suggest that all humans share basic biological and psychological needs, and that every society must solve similar problems of survival and social order.
        `
      },
      {
        id: '1.4',
        title: '1.4 Cultural Change and Adaptation',
        content: `
### 1.4 Cultural Change and Adaptation
Cultures are never static; they are in a constant state of flux.

*   **Mechanisms of Change**:
    1.  **Innovation**: The discovery or invention of new ideas, tools, or methods within a society.
    2.  **Diffusion**: The spread of cultural traits from one society to another through trade, migration, or communication.
    3.  **Acculturation**: The process of cultural change that occurs when two cultures come into prolonged contact (often resulting in one culture adopting traits of the other).
    4.  **Globalization**: The rapid integration of cultures worldwide through technology and international trade.
*   **Cultural Lag**: A term coined by William Ogburn to describe the period of maladjustment when the non-material culture (values, laws) struggles to keep pace with changes in material culture (technology).
*   **Adaptation**: The process by which a culture modifies itself to better suit its environment. For example, the development of irrigation in arid regions.
        `
      },
      {
        id: '1.5',
        title: '1.5 Ethnocentrism vs Cultural Relativism',
        content: `
### 1.5 Ethnocentrism vs Cultural Relativism
These concepts describe how we perceive and judge other cultures.

*   **Ethnocentrism**: The tendency to view one's own culture as superior and to use its standards to judge other cultures.
    *   *Impact*: Can lead to prejudice, discrimination, and conflict. It often stems from a lack of understanding of other ways of life.
*   **Cultural Relativism**: The principle that a culture should be understood on its own terms and within its own context, rather than being judged by the standards of another culture.
    *   *Importance*: It is a crucial tool for anthropologists and sociologists to maintain objectivity. In Nigeria, it is essential for fostering mutual respect among diverse ethnic groups.
*   **Xenocentrism**: The opposite of ethnocentrism; the belief that the products, styles, or ideas of another culture are better than one's own (often seen in the preference for foreign goods in Nigeria).
        `
      }
    ]
  },
  {
    id: 'nigerian-peoples',
    title: '2. NIGERIAN PEOPLES: ETHNIC COMPOSITION',
    subTopics: [
      {
        id: '2.1',
        title: '2.1 Major Ethnic Groups',
        content: `
### 2.1 Major Ethnic Groups
Nigeria is often described as a "tripod" due to the dominance of three major ethnic groups, though this oversimplifies its true diversity.

*   **Hausa-Fulani**:
    *   **Location**: Primarily the Northern part of Nigeria.
    *   **Culture**: Deeply influenced by Islam. The Hausa are traditionally farmers and traders, while the Fulani were historically nomadic pastoralists.
    *   **Political System**: Centralized under the Sultan of Sokoto and various Emirs (the Sarauta system).
*   **Yoruba**:
    *   **Location**: South-Western Nigeria.
    *   **Culture**: Known for a long history of urbanization and sophisticated art (e.g., Ife bronzes). They have a rich tradition of oral literature and complex religious systems (Orishas).
    *   **Political System**: Centralized under monarchs known as Obas (e.g., the Alafin of Oyo, the Ooni of Ife).
*   **Igbo**:
    *   **Location**: South-Eastern Nigeria.
    *   **Culture**: Characterized by an egalitarian and achievement-oriented social structure. They are known for their entrepreneurial spirit and the "Igbo Apprentice System."
    *   **Political System**: Historically acephalous (stateless), with power distributed among elders, age grades, and village assemblies.
        `
      },
      {
        id: '2.2',
        title: '2.2 Minority Ethnic Groups',
        content: `
### 2.2 Minority Ethnic Groups
Nigeria is home to over 250 minority ethnic groups, which collectively make up a significant portion of the population.

*   **Key Minority Groups**:
    *   **North**: Kanuri, Tiv, Nupe, Gbagyi, Idoma, Igala.
    *   **South**: Ijaw, Edo, Ibibio, Efik, Urhobo, Itsekiri, Isoko.
*   **Significance**:
    *   **Cultural Richness**: They contribute unique languages, music, and traditions to the Nigerian identity.
    *   **Political Balance**: Minority groups often play a "swing" role in national politics and have been at the forefront of the struggle for resource control and true federalism (especially in the Niger Delta).
    *   **Middle Belt**: A region of extreme ethnic and linguistic diversity that serves as a cultural bridge between the North and the South.
        `
      },
      {
        id: '2.3',
        title: '2.3 Linguistic Groups in Nigeria',
        content: `
### 2.3 Linguistic Groups in Nigeria
Nigeria is one of the most linguistically diverse countries in the world, with over 500 indigenous languages. These languages are classified into three major families:

1.  **Niger-Congo**: The largest family, including Yoruba, Igbo, Ijaw, Edo, Ibibio, and Fulfulde.
2.  **Afro-Asiatic (Chadic branch)**: Includes Hausa, which is the most widely spoken language in Northern Nigeria and a major lingua franca in West Africa.
3.  **Nilo-Saharan**: Includes Kanuri (spoken in the Borno region).

*   **Lingua Francas**:
    *   **English**: The official language of government, education, and business.
    *   **Nigerian Pidgin**: A widely used English-based creole that serves as a bridge across ethnic divides, especially in urban areas and the South-South.
*   **Language Endangerment**: Many minority languages are at risk of extinction as younger generations shift towards English or major indigenous languages.
        `
      },
      {
        id: '2.4',
        title: '2.4 Settlement Patterns and Population Distribution',
        content: `
### 2.4 Settlement Patterns and Population Distribution
The way people are spread across Nigeria is influenced by geography, history, and economics.

*   **Geographical Factors**:
    *   **The Forest Zone (South)**: Historically supported high population densities due to fertile land and rainfall.
    *   **The Savannah Zone (North)**: Population concentrated around water sources and major trade centers (e.g., Kano).
*   **Historical Factors**:
    *   **Slave Trade**: Led to the depopulation of some areas and the concentration of people in defensible locations (e.g., hill settlements).
    *   **Trade Routes**: Cities grew along the Trans-Saharan routes and later along the coast during the colonial era.
*   **Modern Trends**:
    *   **Urbanization**: Rapid migration from rural areas to cities like Lagos, Abuja, Kano, and Port Harcourt.
    *   **Population Density**: Highest in the South-East and South-West; lowest in the Middle Belt and parts of the far North.
        `
      }
    ]
  },
  {
    id: 'pre-colonial-politics',
    title: '3. PRE-COLONIAL POLITICAL SYSTEMS',
    subTopics: [
      {
        id: '3.1',
        title: '3.1 Centralized Systems (The Emirates and Kingdoms)',
        content: `
### 3.1 Centralized Systems
These were societies with a clearly defined hierarchy and a central authority figure.

*   **The Hausa-Fulani (The Caliphate/Emirates)**:
    *   **Structure**: After the 1804 Jihad, the Sokoto Caliphate was established. It was divided into Emirates, each led by an Emir.
    *   **Administration**: The Emir held executive, legislative, and judicial powers, guided by Islamic Law (Sharia). Key officials included the Waziri (Prime Minister) and Galadima.
*   **The Yoruba (The Oyo Empire)**:
    *   **Structure**: Led by the Alafin of Oyo.
    *   **Checks and Balances**: The Alafin's power was not absolute. He was balanced by the **Oyomesi** (a council of seven kingmakers) led by the Bashorun. The **Ogboni** secret society also played a role in mediation.
*   **The Benin Kingdom**:
    *   **Structure**: Led by the **Oba**, who was seen as a semi-divine figure.
    *   **Administration**: Supported by various ranks of chiefs (Uzama) and palace officials. Known for a highly organized military and administrative structure.
        `
      },
      {
        id: '3.2',
        title: '3.2 Acephalous (Stateless) Societies',
        content: `
### 3.2 Acephalous (Stateless) Societies
These societies lacked a single centralized head of state. Power was decentralized and shared.

*   **The Igbo System**:
    *   **Village Assembly (Oha-na-eze)**: The ultimate decision-making body where every adult male had a voice.
    *   **Council of Elders (Ndichie)**: Respected heads of families who provided guidance.
    *   **Age Grades**: Groups of people born within the same period who performed specific social and military duties.
    *   **Titled Societies (e.g., Ozo, Ezeji)**: Men who attained status through wealth and integrity, serving as moral leaders.
    *   **Secret Societies**: Played roles in law enforcement and spiritual guidance.
*   **The Tiv System**:
    *   Based on a segmentary lineage system where political loyalty was determined by genealogical distance.
*   **Characteristics**: High degree of individual freedom, emphasis on consensus, and merit-based social mobility.
        `
      },
      {
        id: '3.3',
        title: '3.3 Theocratic Systems',
        content: `
### 3.3 Theocratic Systems
In these systems, religious and political authority were inextricably linked.

*   **The Sokoto Caliphate**:
    *   The Sultan was both the political leader and the "Commander of the Faithful" (Sarkin Musulmi).
    *   Governance was based on the Quran and Sunnah.
    *   The Jihad of Usman dan Fodio aimed to purify Islamic practice and establish a state based on social justice and Islamic principles.
*   **Kanem-Borno Empire**:
    *   One of the longest-lasting empires in world history.
    *   Led by the **Mai**, who governed with a council of state. Islam was the state religion and influenced all aspects of life.
        `
      },
      {
        id: '3.4',
        title: '3.4 Traditional Leadership and Social Control',
        content: `
### 3.4 Traditional Leadership and Social Control
Beyond formal structures, pre-colonial societies used various mechanisms to maintain order.

*   **Secret Societies**: (e.g., Ogboni among Yoruba, Ekpe among Efik/Ibibio, Poro in parts of the North). They acted as "police," judges, and custodians of tradition.
*   **Religious Sanctions**: The fear of ancestors or deities served as a powerful deterrent against crime and social deviance.
*   **Ostracism**: Being banished from the community was one of the most severe punishments in decentralized societies.
*   **Oral Tradition**: Myths, legends, and proverbs were used to socialize children into the values and norms of the society.
        `
      }
    ]
  },
  {
    id: 'indigenous-economics',
    title: '4. INDIGENOUS ECONOMIC SYSTEMS',
    subTopics: [
      {
        id: '4.1',
        title: '4.1 Traditional Occupations and Production',
        content: `
### 4.1 Traditional Occupations and Production
Pre-colonial Nigerian economies were diverse and highly specialized based on ecological zones.

*   **Agriculture**: The mainstay of most economies.
    *   **Root Crops (South)**: Yam, cassava, cocoyam.
    *   **Grain Crops (North)**: Millet, sorghum, maize.
    *   **Tree Crops**: Oil palm, kola nut, cocoa (later).
*   **Animal Husbandry**: Primarily in the North (cattle, sheep, goats) by the Fulani.
*   **Fishing**: Dominant in the Niger Delta and along major rivers (Niger, Benue).
*   **Crafts and Industries**:
    *   **Iron Smelting and Blacksmithing**: (e.g., Nok culture, Awka smiths).
    *   **Textiles**: Weaving and dyeing (e.g., Akwete cloth, Kano indigo pits).
    *   **Pottery and Carving**: (e.g., Benin brass, ife terracotta).
        `
      },
      {
        id: '4.2',
        title: '4.2 Trade Networks: Trans-Saharan and Coastal',
        content: `
### 4.2 Trade Networks
Nigeria was a hub of regional and international trade long before the colonial era.

*   **Trans-Saharan Trade**:
    *   Connected Northern Nigeria (Kano, Katsina, Borno) to North Africa and Europe.
    *   **Goods Exported**: Leather, slaves, gold, ivory.
    *   **Goods Imported**: Salt, horses, textiles, books, weapons.
    *   **Impact**: Spread of Islam, literacy, and new administrative ideas.
*   **Coastal/Trans-Atlantic Trade**:
    *   Initially focused on pepper and ivory, then shifted to the **Slave Trade**, and finally to "Legitimate Trade" (palm oil).
    *   **Impact**: Rise of coastal city-states, introduction of firearms, and the devastating social impact of the slave trade.
        `
      },
      {
        id: '4.3',
        title: '4.3 Local Markets and Currencies',
        content: `
### 4.3 Local Markets and Currencies
Markets were the heartbeat of indigenous economic and social life.

*   **Periodic Markets**: Most communities had a cycle of markets (e.g., the 4-day Igbo market week: Eke, Orie, Afor, Nkwo).
*   **Social Function**: Markets were places for news, marriage negotiations, and settling disputes, in addition to trade.
*   **Traditional Currencies**:
    *   **Cowries**: The most widespread currency.
    *   **Manillas**: Bronze or copper "bracelets" used in the South.
    *   **Iron Bars and Cloth**: Used in specific regions.
    *   **Salt**: Often used as a medium of exchange in the North.
*   **Barter System**: Direct exchange of goods was also common, especially between different ecological zones.
        `
      },
      {
        id: '4.4',
        title: '4.4 Land Tenure Systems',
        content: `
### 4.4 Land Tenure Systems
Land was the most important economic resource, and its ownership was governed by custom.

*   **Communal Ownership**: In most Nigerian societies, land belonged to the community, lineage, or family, not individuals.
*   **Trusteeship**: The chief or head of the family held the land in trust for the living, the dead, and the unborn.
*   **Right of Use (Usufruct)**: Individuals had the right to use land as long as they cultivated it, but they could not sell it.
*   **Inheritance**: Land was passed down through the male line in most societies (patrilineal), though some practiced matrilineal inheritance.
        `
      }
    ]
  },
  {
    id: 'marriage-family',
    title: '5. MARRIAGE AND FAMILY SYSTEMS',
    subTopics: [
      {
        id: '5.1',
        title: '5.1 Types of Marriage and Kinship',
        content: `
### 5.1 Types of Marriage and Kinship
Marriage in Nigeria is traditionally a union between two families, not just two individuals.

*   **Monogamy**: One man, one wife.
*   **Polygyny**: One man, multiple wives. Historically favored for increasing agricultural labor, ensuring many children, and enhancing social status.
*   **Levirate Marriage**: A widow marrying her late husband's brother to ensure the continuity of the family and support for the children.
*   **Sororate Marriage**: A man marrying his late wife's sister.
*   **Kinship Systems**:
    *   **Patrilineal**: Descent and inheritance traced through the father's line (most common).
    *   **Matrilineal**: Descent traced through the mother's line (e.g., Ohafia Igbo).
    *   **Bilateral**: Descent traced through both parents.
        `
      },
      {
        id: '5.2',
        title: '5.2 Traditional Marriage Rites',
        content: `
### 5.2 Traditional Marriage Rites
The process of marriage is often long and involves several stages:

1.  **Inquiry/Introduction**: The groom's family visits the bride's family to express interest.
2.  **Investigation**: Both families discreetly check each other's history (health, character, reputation).
3.  **Negotiation of Bride Price (Ime Ego/Owo Ori)**: A symbolic payment or gift from the groom's family to the bride's family. It is not "buying" a wife but a token of appreciation and a legal seal of the union.
4.  **Traditional Wedding Ceremony**: Involves the sharing of food (e.g., kola nuts, wine), prayers by elders, and the formal handing over of the bride.
*   **Significance**: These rites emphasize community approval, family bonding, and the stability of the marriage.
        `
      },
      {
        id: '5.3',
        title: '5.3 Family Structure and Socialization',
        content: `
### 5.3 Family Structure and Socialization
The family is the primary unit of social organization and the first agent of socialization.

*   **The Extended Family**: The hallmark of Nigerian social life. It includes parents, children, grandparents, aunts, uncles, and cousins living together or in close proximity.
    *   *Function*: Provides a social safety net, emotional support, and collective child-rearing.
*   **Socialization**: The process by which children learn the culture of their society.
    *   **Informal Education**: Learning through imitation, storytelling, proverbs, and participation in daily activities.
    *   **Rites of Passage**: Ceremonies marking the transition from one stage of life to another (e.g., naming ceremonies, circumcision, initiation into age grades).
        `
      },
      {
        id: '5.4',
        title: '5.4 Status of Women and Children',
        content: `
### 5.4 Status of Women and Children
*   **Women**: While many traditional societies were patriarchal, women often held significant economic and social power.
    *   *Examples*: Market women leaders (Iyalode), queen mothers, and female titleholders. In some cultures, women were the primary farmers or traders.
*   **Children**: Seen as a blessing and a source of future security.
    *   *Socialization**: Boys and girls were socialized into different roles, but both were taught the importance of respect for elders, hard work, and community loyalty.
    *   *Naming*: Names often reflect the circumstances of birth, family history, or religious beliefs.
        `
      }
    ]
  },
  {
    id: 'religion-nigeria',
    title: '6. RELIGION AND SOCIETY',
    subTopics: [
      {
        id: '6.1',
        title: '6.1 Traditional African Religion (TAR)',
        content: `
### 6.1 Traditional African Religion (TAR)
TAR is the indigenous belief system of Nigerian peoples, existing long before Islam and Christianity.

*   **Core Beliefs**:
    1.  **Supreme Being**: (e.g., Olodumare, Chukwu, Osanobua). The creator of the universe, often seen as distant but ultimate.
    2.  **Lesser Deities/Divinities**: (e.g., Sango, Amadioha, Ogun). Intermediaries between humans and the Supreme Being, associated with natural forces.
    3.  **Ancestors**: The "living dead" who watch over their descendants and must be honored.
    4.  **Spirits**: Both benevolent and malevolent spirits inhabiting the environment.
    5.  **Reincarnation**: The belief that souls return to the world in new bodies.
*   **Practice**: Involves sacrifices, festivals, divination (e.g., Ifa), and the use of charms or medicine.
        `
      },
      {
        id: '6.2',
        title: '6.2 Islam in Nigeria',
        content: `
### 6.2 Islam in Nigeria
*   **Arrival**: Islam reached Northern Nigeria (Borno) as early as the 9th century through the Trans-Saharan trade.
*   **Spread**: It spread through the Hausa states and was later consolidated by the 1804 Jihad of Usman dan Fodio.
*   **Impact**:
    *   Introduced Arabic literacy and scholarship.
    *   Provided a unified legal and administrative framework (Sharia).
    *   Influenced architecture, dressing, and social customs in the North and parts of the South-West.
*   **Sufi Orders**: The Tijaniyya and Qadiriyya orders have historically been influential.
        `
      },
      {
        id: '6.3',
        title: '6.3 Christianity in Nigeria',
        content: `
### 6.3 Christianity in Nigeria
*   **Early Contact**: Portuguese missionaries reached Benin and Warri in the 15th century, but with little lasting impact.
*   **19th Century Missions**: The modern spread began with the arrival of the CMS (Anglicans), Methodists, Catholics, and Baptists.
*   **Impact**:
    *   Introduced Western education and modern healthcare.
    *   Promoted the abolition of certain traditional practices (e.g., killing of twins).
    *   Led to the development of indigenous Christian movements (Aladura) and later the Pentecostal explosion.
*   **Geographic Spread**: Primarily dominant in the South and the Middle Belt.
        `
      },
      {
        id: '6.4',
        title: '6.4 Religious Pluralism and Conflict',
        content: `
### 6.4 Religious Pluralism and Conflict
Nigeria is a deeply religious but multi-faith nation.

*   **Co-existence**: In many parts of Nigeria (especially the South-West), families are multi-religious, and people celebrate each other's festivals.
*   **Conflict**: Religious differences have sometimes been exploited for political ends, leading to communal clashes, especially in the "Middle Belt" and the North.
*   **Secularism**: The Nigerian Constitution defines the state as secular, meaning it should not adopt any state religion, though religion remains a powerful force in public life.
        `
      }
    ]
  },
  {
    id: 'history-nigeria',
    title: '7. HISTORY OF NIGERIA: EVOLUTION OF A NATION',
    subTopics: [
      {
        id: '7.1',
        title: '7.1 Pre-Colonial Era: Early Cultures',
        content: `
### 7.1 Pre-Colonial Era: Early Cultures
Nigeria has a rich archaeological history.

*   **Nok Culture (c. 1500 BC - 200 AD)**: Famous for its sophisticated terracotta sculptures and early iron-working technology in Central Nigeria.
*   **Ife and Benin Art**: Renowned for their realistic bronze and ivory works, indicating highly organized and wealthy societies.
*   **Igbo-Ukwu**: Archaeological finds showing advanced bronze casting and international trade links as early as the 9th century.
*   **The Great Empires**: Kanem-Borno, the Hausa States, the Oyo Empire, and the Benin Kingdom dominated the landscape before European arrival.
        `
      },
      {
        id: '7.2',
        title: '7.2 Colonial Rule and Its Impact',
        content: `
### 7.2 Colonial Rule and Its Impact
*   **The Scramble for Africa**: Britain formally established control through the Royal Niger Company and later direct administration.
*   **Amalgamation (1914)**: Lord Lugard joined the Northern and Southern Protectorates to form modern Nigeria. This was done primarily for administrative and economic convenience.
*   **Indirect Rule**: The British policy of governing through traditional rulers (Emirs, Obas). It worked well in the North but failed in the South-East (leading to the Aba Women's Riot of 1929).
*   **Impact**:
    *   Creation of a modern state structure and infrastructure (railways, roads).
    *   Introduction of a cash-crop economy.
    *   Cultural alienation and the "divide and rule" legacy.
        `
      },
      {
        id: '7.3',
        title: '7.3 The Struggle for Independence',
        content: `
### 7.3 The Struggle for Independence
*   **Nationalism**: Driven by Western-educated elites (e.g., Herbert Macaulay, Nnamdi Azikiwe, Obafemi Awolowo, Ahmadu Bello).
*   **Key Milestones**:
    *   The Richards Constitution (1946).
    *   The Macpherson Constitution (1951).
    *   The Lyttleton Constitution (1954) - established the federal principle.
*   **Independence**: October 1, 1960. Nigeria became a sovereign nation within the Commonwealth.
        `
      },
      {
        id: '7.4',
        title: '7.4 Post-Independence Challenges',
        content: `
### 7.4 Post-Independence Challenges
*   **The First Republic**: Characterized by ethnic politics and regional tensions.
*   **Military Coups**: The first coup in January 1966 led to a series of military interventions.
*   **The Civil War (1967-1970)**: The attempt by the Eastern Region (Biafra) to secede. It ended with the policy of "No Victor, No Vanquished."
*   **The Oil Boom and Bust**: Transformed the economy but also led to corruption and neglect of agriculture.
*   **Return to Democracy**: The Fourth Republic (1999-present) represents Nigeria's longest period of uninterrupted civilian rule.
        `
      }
    ]
  },
  {
    id: 'social-justice',
    title: '8. SOCIAL JUSTICE AND NATIONAL INTEGRATION',
    subTopics: [
      {
        id: '8.1',
        title: '8.1 Concepts of Social Justice and Equity',
        content: `
### 8.1 Concepts of Social Justice and Equity
*   **Social Justice**: The fair and equitable distribution of resources, opportunities, and privileges within a society.
*   **Equity vs Equality**: Equality means giving everyone the same thing; equity means giving everyone what they need to be successful (recognizing historical disadvantages).
*   **Human Rights**: The fundamental rights and freedoms to which all humans are entitled, as enshrined in the Nigerian Constitution and international charters.
        `
      },
      {
        id: '8.2',
        title: '8.2 Challenges to National Integration',
        content: `
### 8.2 Challenges to National Integration
National integration is the process of creating a sense of belonging among diverse groups.

*   **Tribalism/Ethnicism**: Loyalty to one's ethnic group over the nation.
*   **Religious Intolerance**: Conflict arising from a lack of respect for different faiths.
*   **Nepotism and Corruption**: Favoring kin or friends in the distribution of public resources.
*   **Poverty and Inequality**: Create a sense of marginalization and resentment.
*   **Resource Control**: Disputes over the distribution of oil wealth (especially in the Niger Delta).
        `
      },
      {
        id: '8.3',
        title: '8.3 Efforts at National Integration',
        content: `
### 8.3 Efforts at National Integration
The Nigerian government has implemented several policies to foster unity:

*   **NYSC (National Youth Service Corps)**: Established in 1973 to encourage graduates to serve in states other than their own.
*   **Federal Character Principle**: A constitutional requirement that appointments to public office must reflect the linguistic, ethnic, and religious diversity of the country.
*   **Unity Schools**: Federal Government Colleges designed to bring students from different parts of the country together.
*   **National Symbols**: The Flag, Anthem, and Pledge intended to evoke a sense of shared identity.
*   **State Creation**: Aimed at bringing government closer to the people and addressing minority fears.
        `
      }
    ]
  },
  {
    id: 'economy-development',
    title: '9. ECONOMY AND DEVELOPMENT',
    subTopics: [
      {
        id: '9.1',
        title: '9.1 From Agriculture to Oil',
        content: `
### 9.1 From Agriculture to Oil
*   **Pre-1970s**: Nigeria was a leading exporter of groundnuts, cocoa, palm oil, and rubber. Agriculture was the mainstay of the economy.
*   **The Oil Boom**: The discovery and exploitation of crude oil in the Niger Delta transformed Nigeria into a mono-product economy.
*   **Dutch Disease**: The phenomenon where the discovery of natural resources leads to the decline of other sectors (like agriculture and manufacturing).
        `
      },
      {
        id: '9.2',
        title: '9.2 Development Planning in Nigeria',
        content: `
### 9.2 Development Planning in Nigeria
Nigeria has had several development plans aimed at industrialization and poverty reduction:

*   **National Development Plans (1st - 4th)**: Focused on infrastructure and import substitution.
*   **SAP (Structural Adjustment Program)**: Introduced in the 1980s to liberalize the economy, with mixed results.
*   **Vision 2010, Vision 2020, and ERGP**: More recent attempts to diversify the economy and improve governance.
*   **Sustainable Development Goals (SDGs)**: Nigeria's commitment to global targets for poverty, health, and education.
        `
      },
      {
        id: '9.3',
        title: '9.3 Challenges to Economic Development',
        content: `
### 9.3 Challenges to Economic Development
*   **Corruption**: Drains public resources and discourages investment.
*   **Infrastructure Deficit**: Poor power supply, roads, and railways hinder industrial growth.
*   **Unemployment**: Especially among the youth, leading to social instability.
*   **Insecurity**: Terrorism, banditry, and kidnapping disrupt economic activities in many regions.
*   **Dependence on Imports**: Nigeria remains heavily dependent on imported goods, including refined petroleum and food.
        `
      }
    ]
  },
  {
    id: 'science-tech',
    title: '10. SCIENCE AND TECHNOLOGY IN NIGERIA',
    subTopics: [
      {
        id: '10.1',
        title: '10.1 Indigenous Science and Technology',
        content: `
### 10.1 Indigenous Science and Technology
Nigerian peoples had advanced technical knowledge long before Western contact.

*   **Traditional Medicine**: Use of herbs, roots, and spiritual practices for healing.
*   **Iron Smelting**: Sophisticated furnaces and tools (e.g., Nok, Awka).
*   **Architecture**: (e.g., the Great Walls of Benin, the mud-brick architecture of the North).
*   **Textile Technology**: Complex weaving and dyeing techniques.
*   **Food Processing**: Traditional methods for preserving and processing crops like yam and cassava.
        `
      },
      {
        id: '10.2',
        title: '10.2 Modern Science and Technology Development',
        content: `
### 10.2 Modern Science and Technology Development
*   **Research Institutes**: Establishment of bodies like FIIRO, PRODA, and NAFDAC.
*   **Space Technology**: Nigeria has launched several satellites (NigeriaSat) for communication and earth observation.
*   **The Digital Revolution**: Rapid growth in telecommunications and the "Fintech" sector (e.g., Flutterwave, Paystack).
*   **Challenges**: Low funding for R&D, "brain drain" of scientists, and a weak link between research and industry.
        `
      }
    ]
  }
];

export const GET101_SYLLABUS: Module[] = [
  {
    id: 'intro-engineering',
    title: '1. INTRODUCTION TO ENGINEERING',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Engineering Profession',
        content: `
### 1.1 Engineering Profession
The role of engineers in society and the various branches of engineering.
*   **Branches**: Civil, Mechanical, Electrical, Chemical, etc.
*   **Ethics**: Professional responsibility and safety.
        `
      },
      {
        id: '1.2',
        title: '1.2 Engineering Graphics',
        content: `
### 1.2 Engineering Graphics
Introduction to technical drawing and visualization.
*   **Instruments**: Use of drawing tools.
*   **Projections**: Orthographic and isometric projections.
        `
      }
    ]
  }
];

export const GET102_SYLLABUS: Module[] = [
  {
    id: 'applied-mechanics',
    title: '1. APPLIED MECHANICS',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Statics',
        content: `
### 1.1 Statics
Study of forces in equilibrium.
*   **Resultants**: Combining multiple forces.
*   **Moments**: Rotational effect of a force.
        `
      },
      {
        id: '1.2',
        title: '1.2 Strength of Materials',
        content: `
### 1.2 Strength of Materials
How materials respond to external loads.
*   **Stress and Strain**: Fundamental concepts of material deformation.
*   **Hooke's Law**: Relationship between stress and strain.
        `
      }
    ]
  }
];

export const ZOO101_SYLLABUS: Module[] = [
  {
    id: 'intro-zoology',
    title: '1. INTRODUCTION TO ZOOLOGY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Animal Diversity',
        content: `
### 1.1 Animal Diversity
Overview of the animal kingdom and its major groups.
*   **Invertebrates**: Animals without backbones (e.g., insects, mollusks).
*   **Vertebrates**: Animals with backbones (e.g., mammals, birds, reptiles).
        `
      },
      {
        id: '1.2',
        title: '1.2 Evolutionary Principles',
        content: `
### 1.2 Evolutionary Principles
The mechanisms of evolution and natural selection.
*   **Adaptation**: Traits that enhance survival and reproduction.
*   **Speciation**: The process by which new species arise.
        `
      }
    ]
  }
];

export const ZOO102_SYLLABUS: Module[] = [
  {
    id: 'animal-physiology',
    title: '1. ANIMAL PHYSIOLOGY',
    subTopics: [
      {
        id: '1.1',
        title: '1.1 Digestion and Nutrition',
        content: `
### 1.1 Digestion and Nutrition
How animals obtain and process nutrients.
*   **Digestive Systems**: Comparative anatomy of digestive tracts.
*   **Nutrient Absorption**: Mechanisms of nutrient uptake.
        `
      },
      {
        id: '1.2',
        title: '1.2 Respiration and Circulation',
        content: `
### 1.2 Respiration and Circulation
Gas exchange and internal transport in animals.
*   **Respiratory Surfaces**: Gills, lungs, and skin.
*   **Circulatory Systems**: Open vs. closed systems.
        `
      }
    ]
  }
];

export const DEPARTMENTS: Department[] = [
  'Aerospace Engineering', 'Agricultural Engineering', 'Anatomy', 'Biology', 'Biomedical Engineering', 
  'Chemical Engineering', 'Chemistry', 'Civil Engineering', 'Computer Engineering', 'Computer Science', 
  'Dentistry', 'Electrical Engineering', 'Material Science and Engineering', 'Mathematics', 
  'Mechanical Engineering', 'Mechatronics Engineering', 'Medical Laboratory Science', 'Medicine and Surgery', 
  'Nursing Science', 'Petroleum Engineering', 'Pharmacy', 'Physics', 'Physiology', 'Public Health', 
  'Software Engineering', 'Statistics', 'Zoology', 'General Studies', 'General Engineering', 'General Engineering Training'
];

export const LEVELS: Level[] = ['100', '200', '300', '400', '500', '600'];

export const SEMESTERS: Semester[] = ['1st Semester', '2nd Semester'];

export const FACULTIES = [
  'Engineering',
  'Science',
  'Medicine & Health Sciences',
  'General Studies'
];

export const DEPARTMENT_TO_FACULTY: Record<string, string> = {
  'Aerospace Engineering': 'Engineering',
  'Agricultural Engineering': 'Engineering',
  'Biomedical Engineering': 'Engineering',
  'Chemical Engineering': 'Engineering',
  'Civil Engineering': 'Engineering',
  'Computer Engineering': 'Engineering',
  'Electrical Engineering': 'Engineering',
  'Material Science and Engineering': 'Engineering',
  'Mechanical Engineering': 'Engineering',
  'Mechatronics Engineering': 'Engineering',
  'Petroleum Engineering': 'Engineering',
  'Software Engineering': 'Engineering',
  'Anatomy': 'Medicine & Health Sciences',
  'Dentistry': 'Medicine & Health Sciences',
  'Medical Laboratory Science': 'Medicine & Health Sciences',
  'Medicine and Surgery': 'Medicine & Health Sciences',
  'Nursing Science': 'Medicine & Health Sciences',
  'Pharmacy': 'Medicine & Health Sciences',
  'Physiology': 'Medicine & Health Sciences',
  'Public Health': 'Medicine & Health Sciences',
  'Biology': 'Science',
  'Chemistry': 'Science',
  'Computer Science': 'Science',
  'Mathematics': 'Science',
  'Physics': 'Science',
  'Statistics': 'Science',
  'Zoology': 'Science',
  'General Studies': 'General Studies',
  'General Engineering': 'Engineering',
  'General Engineering Training': 'Engineering'
};



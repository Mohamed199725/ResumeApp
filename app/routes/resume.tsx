import {Link, useNavigate, useParams} from "react-router";
import {useEffect, useState} from "react";
import {usePuterStore} from "~/lib/puter";
import Summary from "~/components/Summary";
import ATS from "~/components/ATS";
import Details from "~/components/Details";
import {prepareInstructions} from "../../constants";
import {extractPdfText} from "~/lib/pdf2img";

type StoredResume = {
    id: string;
    resumePath: string;
    imagePath: string;
    companyName?: string;
    jobTitle?: string;
    jobDescription?: string;
    feedback?: Feedback | string;
};

const isFeedback = (value: unknown): value is Feedback => {
    if (!value || typeof value !== 'object') return false;

    const feedback = value as Record<string, unknown>;
    return typeof feedback.overallScore === 'number'
        && ['ATS', 'toneAndStyle', 'content', 'structure', 'skills'].every((key) => {
            const section = feedback[key];
            return !!section
                && typeof section === 'object'
                && typeof (section as Record<string, unknown>).score === 'number'
                && Array.isArray((section as Record<string, unknown>).tips);
        });
};

export const meta = () => ([
    { title: 'Resumind | Review ' },
    { name: 'description', content: 'Detailed overview of your resume' },
])

const Resume = () => {
    const { auth, isLoading, puterReady, error, fs, ai, kv } = usePuterStore();
    const { id } = useParams();
    const [imageUrl, setImageUrl] = useState('');
    const [resumeUrl, setResumeUrl] = useState('');
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [loadError, setLoadError] = useState('');
    const [isLoadingResume, setIsLoadingResume] = useState(true);
    const [storedResume, setStoredResume] = useState<StoredResume | null>(null);
    const [isRetrying, setIsRetrying] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        if(!isLoading && !auth.isAuthenticated) navigate(`/auth?next=/resume/${id}`);
    }, [auth.isAuthenticated, id, isLoading, navigate])

    useEffect(() => {
        if (!puterReady) {
            if (!isLoading && error) {
                setLoadError(error);
                setIsLoadingResume(false);
            }
            return;
        }

        let cancelled = false;
        let createdResumeUrl: string | undefined;
        let createdImageUrl: string | undefined;

        const loadResume = async () => {
            setIsLoadingResume(true);
            setLoadError('');
            setFeedback(null);
            setStoredResume(null);
            setImageUrl('');
            setResumeUrl('');

            try {
                if (!id) throw new Error('Resume not found.');

                const resume = await kv.get(`resume:${id}`);
                if (!resume) throw new Error('Resume not found.');

                const data = JSON.parse(resume);
                if (typeof data.resumePath !== 'string' || typeof data.imagePath !== 'string') {
                    throw new Error('The saved resume files could not be found. Upload the resume again.');
                }
                const savedResume = data as StoredResume;

                const resumeBlob = await fs.read(savedResume.resumePath);
                if (!resumeBlob) throw new Error('The uploaded resume file could not be found.');

                const pdfBlob = new Blob([resumeBlob], { type: 'application/pdf' });
                const resumeUrl = URL.createObjectURL(pdfBlob);
                createdResumeUrl = resumeUrl;

                const imageBlob = await fs.read(savedResume.imagePath);
                if (!imageBlob) {
                    URL.revokeObjectURL(resumeUrl);
                    createdResumeUrl = undefined;
                    throw new Error('The resume preview could not be found.');
                }

                const imageUrl = URL.createObjectURL(imageBlob);
                createdImageUrl = imageUrl;
                if (cancelled) {
                    URL.revokeObjectURL(resumeUrl);
                    URL.revokeObjectURL(imageUrl);
                    createdResumeUrl = undefined;
                    createdImageUrl = undefined;
                    return;
                }

                setResumeUrl(resumeUrl);
                setImageUrl(imageUrl);
                setStoredResume(savedResume);
                if (isFeedback(savedResume.feedback)) setFeedback(savedResume.feedback);
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err instanceof Error ? err.message : 'Failed to load this resume review.');
                }
            } finally {
                if (!cancelled) setIsLoadingResume(false);
            }
        }

        loadResume();

        return () => {
            cancelled = true;
            if (createdResumeUrl) URL.revokeObjectURL(createdResumeUrl);
            if (createdImageUrl) URL.revokeObjectURL(createdImageUrl);
        };
    }, [error, fs, id, isLoading, kv, puterReady]);

    const retryReview = async () => {
        if (!storedResume) return;

        setIsRetrying(true);
        setLoadError('');
        try {
            const resumeBlob = await fs.read(storedResume.resumePath);
            if (!resumeBlob) throw new Error('The uploaded resume file could not be found.');

            const resumeText = await extractPdfText(resumeBlob);
            if (!resumeText) {
                throw new Error('This PDF has no selectable text. It may be a scanned document; upload a text-based PDF for analysis.');
            }

            const result = await ai.feedback(
                resumeText,
                prepareInstructions({
                    jobTitle: storedResume.jobTitle || '',
                    jobDescription: storedResume.jobDescription || '',
                })
            );
            if (!result) throw new Error('Failed to analyze resume.');

            const content = typeof result.message.content === 'string'
                ? result.message.content
                : result.message.content[0]?.text;
            if (!content) throw new Error('The analysis returned no feedback.');

            const updatedResume = {
                ...storedResume,
                feedback: JSON.parse(content),
            };
            if (!isFeedback(updatedResume.feedback)) {
                throw new Error('The analysis returned feedback in an unexpected format. Please try again.');
            }

            const saved = await kv.set(`resume:${storedResume.id}`, JSON.stringify(updatedResume));
            if (!saved) throw new Error('Failed to save the resume review.');

            setStoredResume(updatedResume);
            setFeedback(updatedResume.feedback);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to complete the resume review.');
        } finally {
            setIsRetrying(false);
        }
    };

    return (
        <main className="!pt-0">
            <nav className="resume-nav">
                <Link to="/" className="back-button">
                    <img src="/icons/back.svg" alt="logo" className="w-2.5 h-2.5" />
                    <span className="text-gray-800 text-sm font-semibold">Back to Homepage</span>
                </Link>
            </nav>
            <div className="flex flex-row w-full max-lg:flex-col-reverse">
                <section className="feedback-section bg-[url('/images/bg-small.svg') bg-cover h-[100vh] sticky top-0 items-center justify-center">
                    {imageUrl && resumeUrl && (
                        <div className="animate-in fade-in duration-1000 gradient-border max-sm:m-0 h-[90%] max-wxl:h-fit w-fit">
                            <a href={resumeUrl} target="_blank" rel="noopener noreferrer">
                                <img
                                    src={imageUrl}
                                    className="w-full h-full object-contain rounded-2xl"
                                    title="resume"
                                />
                            </a>
                        </div>
                    )}
                </section>
                <section className="feedback-section">
                    <h2 className="text-4xl !text-black font-bold">Resume Review</h2>
                    {storedResume && (
                        <div className="my-4">
                            <button
                                type="button"
                                className="primary-button"
                                onClick={retryReview}
                                disabled={isRetrying}
                            >
                                {isRetrying ? 'Analyzing resume...' : feedback ? 'Reanalyze resume' : 'Retry review'}
                            </button>
                            {loadError && (
                                <p role="alert" className="mt-3 text-red-700">{loadError}</p>
                            )}
                        </div>
                    )}
                    {feedback ? (
                        <div className="flex flex-col gap-8 animate-in fade-in duration-1000">
                            <Summary feedback={feedback} />
                            <ATS score={feedback.ATS.score || 0} suggestions={feedback.ATS.tips || []} />
                            <Details feedback={feedback} />
                        </div>
                    ) : storedResume && !isFeedback(storedResume.feedback) ? (
                        <div className="rounded-2xl bg-amber-50 p-6 text-amber-800">
                            <p>This resume does not have a completed review yet.</p>
                        </div>
                    ) : loadError ? (
                        <div role="alert" className="rounded-2xl bg-red-50 p-6 text-red-700">
                            {loadError}
                        </div>
                    ) : isLoadingResume ? (
                        <img src="/images/resume-scan-2.gif" className="w-full" />
                    ) : (
                        <div role="alert" className="rounded-2xl bg-red-50 p-6 text-red-700">
                            This resume review could not be loaded.
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
export default Resume

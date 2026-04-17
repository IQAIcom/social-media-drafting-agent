import { Drafter } from "@/components/drafter";
import { Hero } from "@/components/hero";
import { Navbar } from "@/components/navbar";

export default function Home() {
	return (
		<>
			<Navbar />
			<div className="min-h-screen bg-background flex flex-col">
				<main className="container mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-20 max-w-6xl">
					<Hero />
					<Drafter />
				</main>
			</div>
		</>
	);
}

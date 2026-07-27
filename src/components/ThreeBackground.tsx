import { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Partner logo list
const partnerIcons = [
    '/Icon_Partner_Transparent/Key Factor-1.png',
    '/Icon_Partner_Transparent/KnowBe4-1024x536.png',
    ...Array.from({ length: 38 }).map((_, i) => `/Icon_Partner_Transparent/Partners${i + 1}.png`)
];

const ICON_COUNT = 50; // Reduced for smooth 60fps

function FloatingIcons() {
    const group = useRef<THREE.Group>(null);
    const [textures, setTextures] = useState<THREE.Texture[]>([]);
    const totalTextures = partnerIcons.length;

    // Load ALL textures once
    useEffect(() => {
        const loader = new THREE.TextureLoader();
        const loaded: THREE.Texture[] = [];
        let count = 0;

        partnerIcons.forEach((url, i) => {
            loader.load(
                url,
                (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.generateMipmaps = true;
                    tex.minFilter = THREE.LinearMipmapLinearFilter;
                    loaded[i] = tex;
                    if (++count === totalTextures) setTextures([...loaded]);
                },
                undefined,
                () => {
                    loaded[i] = new THREE.Texture();
                    if (++count === totalTextures) setTextures([...loaded]);
                }
            );
        });
    }, [totalTextures]);

    // Static initial positions — memoised so they don't recalculate
    const iconData = useMemo(() => {
        return Array.from({ length: ICON_COUNT }).map(() => ({
            textureIndex: Math.floor(Math.random() * totalTextures),
            position: new THREE.Vector3(
                (Math.random() - 0.5) * 60,
                (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 20 - 5
            ),
            rotation: new THREE.Euler(0, 0, (Math.random() - 0.5) * 0.15),
            speed: {
                x: (Math.random() - 0.5) * 0.25,
                y: (Math.random() - 0.5) * 0.2 + 0.08,
            },
            scale: Math.random() * 2.2 + 1.8, // Slightly larger = more visible
        }));
    }, [totalTextures]);

    useFrame((_, delta) => {
        if (!group.current || textures.length < totalTextures) return;

        group.current.children.forEach((child, i) => {
            const d = iconData[i];
            child.position.x += d.speed.x * delta;
            child.position.y += d.speed.y * delta;

            if (child.position.x > 35) child.position.x = -35;
            else if (child.position.x < -35) child.position.x = 35;
            if (child.position.y > 25) child.position.y = -25;
            else if (child.position.y < -25) child.position.y = 25;
        });
    });

    if (textures.length < totalTextures) return null;

    return (
        <group ref={group}>
            {iconData.map((data, index) => {
                const tex = textures[data.textureIndex];
                if (!tex) return null;
                return (
                    <mesh
                        key={index}
                        position={data.position}
                        rotation={data.rotation}
                        scale={[data.scale * 1.6, data.scale * 0.9, 1]}
                    >
                        <planeGeometry args={[1, 1]} />
                        <meshBasicMaterial
                            map={tex}
                            transparent={true}
                            opacity={1}
                            alphaTest={0.15}     // Cut off any near-transparent edges
                            depthWrite={true}
                            side={THREE.FrontSide}
                            toneMapped={false}
                        />
                    </mesh>
                );
            })}
        </group>
    );
}

export default function ThreeBackground() {
    return (
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-80">
            <Canvas
                camera={{ position: [0, 0, 15], fov: 60 }}
                gl={{ antialias: false, powerPreference: 'low-power' }} // Optimize GPU usage
                dpr={[1, 1.5]} // Cap pixel ratio for performance
            >
                <ambientLight intensity={1.5} />
                <fog attach="fog" args={['#e0e5ec', 20, 45]} />
                <FloatingIcons />
            </Canvas>
        </div>
    );
}
